/**
 * DeepSeek 余额 World:按操作员或 bot 登记的账户向 DeepSeek 查余额，读数原样交给 bot。
 *
 * 读数来自三处：工具、面板、World 自己的两个定时(播报时刻、警告线检查)。同一账户 `cacheSec` 内的查询共用上次结果，
 * 同时发起的查询共用一个请求。每次查到新读数都对照警告线：从线上方跌到下方推一条 `deepseek-usage.low`,回到上方后再跌破才再推。
 * 定时播报在每个时刻之后 `LATE_MAX_MIN` 分钟内发一次，bot 没开错过的不补。
 *
 * 读数是服务商返回的外部内容，事件按 external 推送。key 只经 `secret()` 读，回执与面板只给打码后的样子。
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Language } from 'cortico/core/language.ts';
import type { Logger, ToolDef, World, WorldHost, WorldWebUiDecl } from 'cortico/core/types.ts';
import type { DeepPartial } from 'cortico/world.ts';
import { nowIso } from 'cortico/core/util.ts';
import { localParts, mdhm, toMinutes } from './clock.ts';
import { configGroups, DEEPSEEK_USAGE_ID, secretName, type Account, type DeepseekUsageConfigSection } from './config.ts';
import { QueryError, queryBalance, type FetchLike } from './deepseek.ts';
import { MODEL_TEXT, readingLines, type ModelText } from './model-text.ts';
import { QUICK_PANEL, SCHEDULE_PANEL, type AccountView, type PanelState, type TestResult } from './panel-state.ts';
import { amount, maskKey, money, parseTimes, READING_NAMES, type Currency, type Snapshot } from './readings.ts';
import { DEEPSEEK_USAGE_TOOL_DECLS } from './tools.ts';

const ENV_PROMPT_FILES = {
  zh: fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url)),
  en: fileURLToPath(new URL('./ENV_PROMPT.en.md', import.meta.url)),
};

const MIN = 60_000;
/** 两个定时的检查间隔。 */
const TICK_MS = 30_000;
/** 播报时刻过去这么多分钟内仍会补发(计时器误差、刚启动)。 */
const LATE_MAX_MIN = 10;
const LABEL_MAX = 40;
const DEFAULT_LABEL = 'DeepSeek';

export interface DeepseekUsageWorldOptions {
  cfg: DeepseekUsageConfigSection;
  timezone: string;
  /** 状态文件 `deepseek-usage-state.json` 所在目录(部署共用的数据目录)。 */
  dataDir: string;
  secret: (name: string) => string;
  /** 写进部署 `.env`;空串为移除。 */
  storeSecret: (name: string, value: string) => void;
  /** 深合并进 `worlds.deepseek-usage`,数组整体替换。 */
  persist: (patch: DeepPartial<DeepseekUsageConfigSection>) => void;
  fetch?: FetchLike;
  now?: () => number;
  /** 两次定时检查的间隔，也是启动后第一次检查的延迟;缺省启动即查、之后每 30 秒。 */
  tickMs?: number;
}

interface StateFile {
  snapshots: Record<string, Snapshot>;
  /** 余额在警告线以下的账户。 */
  below: Record<string, boolean>;
  /** 各播报时刻上次发出的本地日期。 */
  reported: Record<string, string>;
}

type Outcome = { snapshot: Snapshot } | { error: QueryError };

interface NewAccount {
  key: string;
  label?: string;
  warnBelow?: number | null;
}

export class DeepseekUsageWorld implements World {
  readonly id = DEEPSEEK_USAGE_ID;
  private host: WorldHost | null = null;
  private log: Logger | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = true;
  private ticking = false;
  private lastAlertCheck = 0;
  private state: StateFile = { snapshots: {}, below: {}, reported: {} };
  private readonly errors = new Map<string, QueryError>();
  private readonly inflight = new Map<string, Promise<Outcome>>();
  private readonly clock: () => number;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly opts: DeepseekUsageWorldOptions) {
    this.clock = opts.now ?? Date.now;
    // 调用时再取全局 fetch:预览与测试可以替换它
    this.fetchImpl = opts.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.loadState();
  }

  private get cfg(): DeepseekUsageConfigSection {
    return this.opts.cfg;
  }

  private get t(): ModelText {
    return MODEL_TEXT[this.cfg.promptLanguage] ?? MODEL_TEXT.zh;
  }

  private get tz(): string {
    return this.opts.timezone;
  }

  private get accounts(): Account[] {
    return Array.isArray(this.cfg.accounts) ? this.cfg.accounts : [];
  }

  // ---------------------------------------------------------------- 生命周期

  async start(host: WorldHost): Promise<void> {
    this.host = host;
    this.log = host.log;
    this.stopped = false;
    this.lastAlertCheck = 0;
    this.schedule(this.opts.tickMs ?? 0);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.host = null;
  }

  private schedule(ms = this.opts.tickMs ?? TICK_MS): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => { void this.tick().finally(() => this.schedule()); }, ms);
  }

  /** 到点的播报与到期的警告线检查。 */
  async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      const now = this.clock();
      if (this.cfg.schedule.enabled) {
        const p = localParts(this.tz, now);
        const due = parseTimes(this.cfg.schedule.times).filter((t) => {
          const late = p.minutes - toMinutes(t);
          return late >= 0 && late <= LATE_MAX_MIN && this.state.reported[t] !== p.date;
        });
        if (due.length) {
          for (const t of due) this.state.reported[t] = p.date;
          this.saveState();
          await this.report(true);
        }
      }
      const watched = this.accounts.filter((a) => a.warnBelow !== null);
      if (watched.length && now - this.lastAlertCheck >= this.cfg.alerts.checkMinutes * MIN) {
        this.lastAlertCheck = now;
        await Promise.all(watched.map((a) => this.read(a)));
      }
    } catch (err) {
      this.log?.warn('deepseek-usage 定时检查出错', { err: String(err) });
    } finally {
      this.ticking = false;
    }
  }

  // ---------------------------------------------------------------- 查询

  /** 读一个账户:`cacheSec` 内的读数直接用;`force` 跳过缓存。 */
  private read(account: Account, force = false): Promise<Outcome> {
    const cached = this.state.snapshots[account.id];
    const now = this.clock();
    if (!force && cached && !this.errors.has(account.id) && now - cached.at < this.cfg.cacheSec * 1000) return Promise.resolve({ snapshot: cached });
    const running = this.inflight.get(account.id);
    if (running) return running;
    const job = this.fetchAccount(account).finally(() => this.inflight.delete(account.id));
    this.inflight.set(account.id, job);
    return job;
  }

  private async fetchAccount(account: Account): Promise<Outcome> {
    const key = this.opts.secret(secretName(account.id)).trim();
    let outcome: Outcome;
    try {
      if (!key) throw new QueryError('nokey', null, secretName(account.id));
      outcome = { snapshot: await queryBalance(key, this.fetchImpl, this.clock()) };
    } catch (err) {
      outcome = { error: asQueryError(err) };
    }
    // 读的过程中账户可能被删了
    if (!this.accounts.some((a) => a.id === account.id)) return outcome;
    if ('snapshot' in outcome) await this.accept(account, outcome.snapshot);
    else this.errors.set(account.id, outcome.error);
    return outcome;
  }

  /** 存下新读数并对照警告线。 */
  private async accept(account: Account, snap: Snapshot): Promise<void> {
    this.errors.delete(account.id);
    this.state.snapshots[account.id] = snap;
    this.saveState();
    await this.checkLine(account, snap);
  }

  /** 对照警告线，跌破时推一条事件。 */
  private async checkLine(account: Account, snap: Snapshot): Promise<void> {
    const primary = snap.primary;
    const below = account.warnBelow !== null && primary !== null && primary.value < account.warnBelow;
    const was = !!this.state.below[account.id];
    if (below === was) return;
    if (below) this.state.below[account.id] = true;
    else delete this.state.below[account.id];
    this.saveState();
    if (!below || !primary) return;
    const t = this.t;
    const name = t.zh ? READING_NAMES.total.zh : READING_NAMES.total.en;
    await this.push('low', t.low(account.label, `${name} ${money(primary.value, primary.currency)}`, money(account.warnBelow!, primary.currency), mdhm(this.tz, snap.at)), this.cfg.alerts.wake, snap.at);
  }

  private async push(noun: string, text: string, wake: boolean, at: number): Promise<void> {
    if (!this.host || this.stopped) return;
    try {
      await this.host.pushEvent(
        { type: `${DEEPSEEK_USAGE_ID}.${noun}`, source: DEEPSEEK_USAGE_ID, senderKey: DEEPSEEK_USAGE_ID, ts: nowIso(this.tz, new Date(at)), text },
        { trigger: wake ? 'flush' : 'piggyback' },
      );
    } catch (err) {
      this.log?.warn('deepseek-usage 事件推送失败', { noun, err: String(err) });
    }
  }

  /** 一个账户的回执段落。 */
  private block(account: Account, outcome: Outcome, t: ModelText): string {
    if ('error' in outcome) return t.failed(account.label, account.id, t.error(outcome.error));
    const lines = [t.head(account.label, account.id, mdhm(this.tz, outcome.snapshot.at)), ...readingLines(outcome.snapshot, t.zh)];
    if (account.warnBelow !== null) lines.push(t.warnLine(account.warnBelow, this.currencyOf(account)));
    return lines.join('\n');
  }

  private async readAll(accounts: Account[], force = false): Promise<Array<[Account, Outcome]>> {
    return Promise.all(accounts.map(async (a) => [a, await this.read(a, force)] as [Account, Outcome]));
  }

  /** 全部账户的播报正文;`send` 时推成 `deepseek-usage.report`。 */
  async report(send: boolean): Promise<string> {
    const t = this.t;
    const now = this.clock();
    const accounts = this.accounts;
    const body = accounts.length ? (await this.readAll(accounts)).map(([a, o]) => this.block(a, o, t)).join('\n\n') : t.noAccounts;
    const text = `${t.reportHead(mdhm(this.tz, now))}\n${body}`;
    if (send) await this.push('report', text, this.cfg.schedule.wake, now);
    return text;
  }

  // ---------------------------------------------------------------- 账户

  private find(name: unknown): Account | null {
    const n = String(name ?? '').trim().toLowerCase();
    if (!n) return null;
    return this.accounts.find((a) => a.id === n) ?? this.accounts.find((a) => a.label.trim().toLowerCase() === n) ?? null;
  }

  private findById(id: unknown): Account {
    const a = this.accounts.find((x) => x.id === id);
    if (!a) throw new Error(`no account ${String(id)}`);
    return a;
  }

  /** 第一个账户叫 `main`,之后 `account-2`、`account-3`…… */
  private nextId(): string {
    const taken = new Set(this.accounts.map((a) => a.id));
    if (!taken.has('main')) return 'main';
    for (let n = 2; ; n++) if (!taken.has(`account-${n}`)) return `account-${n}`;
  }

  private nextLabel(): string {
    const taken = new Set(this.accounts.map((a) => a.label));
    if (!taken.has(DEFAULT_LABEL)) return DEFAULT_LABEL;
    for (let n = 2; ; n++) if (!taken.has(`${DEFAULT_LABEL} ${n}`)) return `${DEFAULT_LABEL} ${n}`;
  }

  private currencyOf(account: Account): Currency | null {
    return this.state.snapshots[account.id]?.primary?.currency ?? null;
  }

  private saveAccounts(accounts: Account[]): void {
    this.opts.persist({ accounts });
  }

  /** 先用这把 key 查一次，查通才登记。 */
  async addAccount(input: NewAccount): Promise<{ ok: true; account: Account } | { ok: false; error: QueryError }> {
    const key = String(input.key ?? '').trim();
    if (!key) return { ok: false, error: new QueryError('nokey', null, 'key') };
    let snapshot: Snapshot;
    try {
      snapshot = await queryBalance(key, this.fetchImpl, this.clock());
    } catch (err) {
      return { ok: false, error: asQueryError(err) };
    }
    const account: Account = {
      id: this.nextId(),
      label: String(input.label ?? '').trim().slice(0, LABEL_MAX) || this.nextLabel(),
      warnBelow: typeof input.warnBelow === 'number' && Number.isFinite(input.warnBelow) ? input.warnBelow : null,
    };
    this.opts.storeSecret(secretName(account.id), key);
    this.saveAccounts([...this.accounts, account]);
    await this.accept(account, snapshot);
    return { ok: true, account };
  }

  removeAccount(account: Account): void {
    this.opts.storeSecret(secretName(account.id), '');
    this.saveAccounts(this.accounts.filter((a) => a.id !== account.id));
    delete this.state.snapshots[account.id];
    delete this.state.below[account.id];
    this.errors.delete(account.id);
    this.saveState();
  }

  private updateAccount(account: Account, patch: Partial<Pick<Account, 'label' | 'warnBelow'>>): Account {
    const next = { ...account, ...patch };
    this.saveAccounts(this.accounts.map((a) => (a.id === account.id ? next : a)));
    return next;
  }

  /** 改警告线后按上次读数重新对照一次。 */
  private async setLine(account: Account, warnBelow: number | null): Promise<Account> {
    const next = this.updateAccount(account, { warnBelow });
    delete this.state.below[account.id];
    this.saveState();
    const snap = this.state.snapshots[account.id];
    if (snap) await this.checkLine(next, snap);
    return next;
  }

  private setSchedule(patch: { enabled?: boolean; times?: string[]; wake?: boolean }): void {
    const out: DeepPartial<DeepseekUsageConfigSection>['schedule'] = {};
    if (patch.times) out.times = patch.times.join(', ');
    if (typeof patch.enabled === 'boolean') out.enabled = patch.enabled;
    if (typeof patch.wake === 'boolean') out.wake = patch.wake;
    // 改时刻后今天已经过去的时刻不补发
    const p = localParts(this.tz, this.clock());
    for (const t of parseTimes(out.times ?? '')) if (toMinutes(t) < p.minutes) this.state.reported[t] = p.date;
    this.saveState();
    this.opts.persist({ schedule: out });
  }

  // ---------------------------------------------------------------- 工具

  envPromptVars(): Record<string, string> {
    const zh = this.cfg.promptLanguage !== 'en';
    const none = zh ? '没有' : 'none';
    const accounts = this.accounts.map((a) => `${a.label} [${a.id}]`).join(zh ? '、' : ', ');
    const times = parseTimes(this.cfg.schedule.times);
    const lines = this.accounts.filter((a) => a.warnBelow !== null).map((a) => {
      const c = this.currencyOf(a);
      return `${a.label} ${c ? money(a.warnBelow!, c) : amount(a.warnBelow!)}`;
    });
    return {
      'deepseek-usage.accounts': accounts || none,
      'deepseek-usage.schedule': this.cfg.schedule.enabled && times.length ? times.join(zh ? '、' : ', ') : none,
      'deepseek-usage.alerts': lines.join(zh ? ';' : '; ') || none,
    };
  }

  tools(): ToolDef[] {
    const handlers: Record<string, ToolDef['handler']> = {
      deepseek_usage_check: async (args) => this.checkTool(args),
      deepseek_usage_add_account: async (args) => this.addTool(args),
      deepseek_usage_edit_account: async (args) => this.editTool(args),
      deepseek_usage_set_schedule: async (args) => this.scheduleTool(args),
    };
    return DEEPSEEK_USAGE_TOOL_DECLS.map((d) => ({ ...d, handler: handlers[d.name]! }));
  }

  private async checkTool(args: Record<string, unknown>): Promise<string> {
    const t = this.t;
    if (!this.accounts.length) return t.noAccounts;
    let accounts = this.accounts;
    if (args.account !== undefined && String(args.account).trim()) {
      const a = this.find(args.account);
      if (!a) return t.noSuchAccount(String(args.account), this.accounts.map((x) => x.id).join(', '));
      accounts = [a];
    }
    return (await this.readAll(accounts)).map(([a, o]) => this.block(a, o, t)).join('\n\n');
  }

  private async addTool(args: Record<string, unknown>): Promise<string> {
    const t = this.t;
    const res = await this.addAccount({
      key: String(args.key ?? ''),
      label: typeof args.label === 'string' ? args.label : undefined,
      warnBelow: typeof args.warn_below === 'number' ? args.warn_below : null,
    });
    if (!res.ok) return t.addFailed(t.error(res.error));
    const a = res.account;
    return `${t.added(a.label, a.id, maskKey(String(args.key)))}\n${this.block(a, { snapshot: this.state.snapshots[a.id]! }, t)}`;
  }

  private async editTool(args: Record<string, unknown>): Promise<string> {
    const t = this.t;
    let a = this.find(args.account);
    if (!a) return t.noSuchAccount(String(args.account ?? ''), this.accounts.map((x) => x.id).join(', '));
    if (args.remove === true) {
      this.removeAccount(a);
      return t.removed(a.label);
    }
    const changes: string[] = [];
    if (typeof args.label === 'string' && args.label.trim()) {
      a = this.updateAccount(a, { label: args.label.trim().slice(0, LABEL_MAX) });
      changes.push(t.renamed(a.label));
    }
    if (args.clear_warning === true) {
      a = await this.setLine(a, null);
      changes.push(t.warnCleared);
    } else if (typeof args.warn_below === 'number' && Number.isFinite(args.warn_below)) {
      a = await this.setLine(a, args.warn_below);
      const c = this.currencyOf(a);
      changes.push(t.warnSet(c ? money(args.warn_below, c) : amount(args.warn_below)));
    }
    return changes.length ? t.edited(a.label, changes) : t.nothingToEdit;
  }

  private async scheduleTool(args: Record<string, unknown>): Promise<string> {
    const t = this.t;
    let times: string[] | undefined;
    if (Array.isArray(args.times)) {
      const raw = args.times.map(String);
      const bad = raw.filter((r) => !parseTimes(r).length);
      if (bad.length) return t.badTimes(bad.join(', '));
      times = parseTimes(raw.join(','));
    }
    this.setSchedule({
      ...(times ? { times, enabled: times.length > 0 } : {}),
      ...(typeof args.wake === 'boolean' ? { wake: args.wake } : {}),
    });
    const on = this.cfg.schedule.enabled ? parseTimes(this.cfg.schedule.times) : [];
    return t.schedule(on, this.cfg.schedule.wake);
  }

  // ---------------------------------------------------------------- 面板

  async invoke(panel: string, method: string, args: unknown[]): Promise<unknown> {
    if (panel !== QUICK_PANEL && panel !== SCHEDULE_PANEL) throw new Error(`unknown panel ${panel}`);
    const zh = args.at(-1) !== 'en';
    const t = zh ? MODEL_TEXT.zh : MODEL_TEXT.en;
    switch (method) {
      case 'state': return this.panelState(zh);
      case 'test': {
        try {
          return { ok: true, snapshot: await queryBalance(String(args[0] ?? ''), this.fetchImpl, this.clock()) } satisfies TestResult;
        } catch (err) {
          return { ok: false, error: t.error(asQueryError(err)) } satisfies TestResult;
        }
      }
      case 'add': {
        const res = await this.addAccount(args[0] as NewAccount);
        if (!res.ok) throw new Error(t.error(res.error));
        return this.panelState(zh);
      }
      case 'setLabel': {
        const label = String(args[1] ?? '').trim().slice(0, LABEL_MAX);
        if (label) this.updateAccount(this.findById(args[0]), { label });
        return this.panelState(zh);
      }
      case 'setWarn': {
        const v = args[1] === null || args[1] === '' ? null : Number(args[1]);
        await this.setLine(this.findById(args[0]), v === null || !Number.isFinite(v) ? null : v);
        return this.panelState(zh);
      }
      case 'replaceKey': {
        const a = this.findById(args[0]);
        const key = String(args[1] ?? '').trim();
        let snap: Snapshot;
        try {
          snap = await queryBalance(key, this.fetchImpl, this.clock());
        } catch (err) {
          throw new Error(t.error(asQueryError(err)));
        }
        this.opts.storeSecret(secretName(a.id), key);
        await this.accept(a, snap);
        return this.panelState(zh);
      }
      case 'remove':
        this.removeAccount(this.findById(args[0]));
        return this.panelState(zh);
      case 'read':
        await this.readAll(this.accounts);
        return this.panelState(zh);
      case 'refresh': {
        const id = args.length > 1 ? args[0] : null;
        await this.readAll(id ? [this.findById(id)] : this.accounts, true);
        return this.panelState(zh);
      }
      case 'setSchedule':
        this.setSchedule(args[0] as { enabled?: boolean; times?: string[]; wake?: boolean });
        return this.panelState(zh);
      case 'setAlerts': {
        const p = args[0] as { checkMinutes?: number; wake?: boolean };
        const out: DeepPartial<DeepseekUsageConfigSection>['alerts'] = {};
        if (typeof p.checkMinutes === 'number' && p.checkMinutes >= 5 && p.checkMinutes <= 1440) out.checkMinutes = Math.round(p.checkMinutes);
        if (typeof p.wake === 'boolean') out.wake = p.wake;
        this.opts.persist({ alerts: out });
        return this.panelState(zh);
      }
      case 'preview': return this.report(false);
      case 'sendNow': {
        if (!this.host) throw new Error(zh ? 'World 没有在运行，发不出事件' : 'The World is not running; no event was sent');
        return this.report(true);
      }
      default: throw new Error(`unknown method ${method}`);
    }
  }

  panelState(zh = true): PanelState {
    const t = zh ? MODEL_TEXT.zh : MODEL_TEXT.en;
    const accounts: AccountView[] = this.accounts.map((a) => {
      const key = this.opts.secret(secretName(a.id)).trim();
      const err = this.errors.get(a.id);
      return {
        id: a.id,
        label: a.label,
        masked: key ? maskKey(key) : null,
        warnBelow: a.warnBelow,
        snapshot: this.state.snapshots[a.id] ?? null,
        error: err ? t.error(err) : null,
        below: !!this.state.below[a.id],
      };
    });
    const times = parseTimes(this.cfg.schedule.times);
    const p = localParts(this.tz, this.clock());
    const later = times.find((x) => toMinutes(x) > p.minutes);
    return {
      accounts,
      schedule: {
        enabled: this.cfg.schedule.enabled,
        times,
        wake: this.cfg.schedule.wake,
        next: !this.cfg.schedule.enabled || !times.length ? null : later ? { day: 'today', time: later } : { day: 'tomorrow', time: times[0]! },
      },
      alerts: { checkMinutes: this.cfg.alerts.checkMinutes, wake: this.cfg.alerts.wake },
      timezone: this.tz,
    };
  }

  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const zh = language === 'zh' || language === 'zh-Hant';
    const failing = this.accounts.filter((a) => this.errors.has(a.id));
    const low = this.accounts.filter((a) => this.state.below[a.id]);
    const title = zh ? 'DeepSeek 余额' : 'DeepSeek Usage';
    return {
      label: title,
      lamps: [{
        label: zh ? '查询' : 'Reading',
        state: !this.accounts.length ? 'offline' : failing.length ? 'error' : 'online',
        hint: failing.length ? failing.map((a) => a.label).join(', ') : undefined,
      }],
      badges: [
        { label: zh ? '账户' : 'Accounts', value: this.accounts.length, tone: 'plain' },
        ...(low.length ? [{ label: zh ? '低于警告线' : 'Below line', value: low.length, tone: 'off' as const }] : []),
      ],
      panels: [
        { id: QUICK_PANEL, title: zh ? '快速配置' : 'Quick setup', description: zh ? '登记账户、看余额、设警告线。' : 'Accounts, balances and warning lines.', getMethods: ['state'] },
        { id: SCHEDULE_PANEL, title: zh ? '定时与提醒' : 'Schedule & alerts', description: zh ? '什么时候把余额告诉 bot。' : 'When the bot hears about balances.', getMethods: ['state', 'preview'] },
      ],
      invoke: (panel, method, args) => this.invoke(panel, method, [...args, zh ? 'zh' : 'en']),
      config: configGroups(language),
      storage: [{
        key: `${DEEPSEEK_USAGE_ID}.state`,
        label: zh ? '读数与提醒状态' : 'Readings and alert state',
        kind: 'disk',
        location: this.stateFile(),
        note: zh ? '清除后警告线状态重置，跌破的账户会再提醒一次。' : 'Clearing resets the alert state; accounts below their line alert again.',
        stat: () => `${Object.keys(this.state.snapshots).length} ${zh ? '个账户' : 'accounts'}`,
        clear: () => {
          const n = Object.keys(this.state.snapshots).length;
          this.state = { snapshots: {}, below: {}, reported: {} };
          rmSync(this.stateFile(), { force: true });
          return `${n}`;
        },
      }],
      promptDocs: [{
        key: `worlds.${DEEPSEEK_USAGE_ID}.envPrompt`,
        title: `${title} · ${zh ? '环境提示词' : 'environment prompt'}`,
        description: zh ? '告诉 bot 能查哪些账户、会收到哪些事件。' : 'Tells the bot which accounts it can read and which events arrive.',
        path: ENV_PROMPT_FILES[this.cfg.promptLanguage] ?? ENV_PROMPT_FILES.zh,
        role: 'envPrompt',
        vars: [
          { name: 'deepseek-usage.accounts', description: zh ? '登记的账户。' : 'Registered accounts.' },
          { name: 'deepseek-usage.schedule', description: zh ? '定时播报的时刻。' : 'Scheduled report times.' },
          { name: 'deepseek-usage.alerts', description: zh ? '各账户的警告线。' : 'Warning lines.' },
        ],
      }],
    };
  }

  // ---------------------------------------------------------------- 状态文件

  private stateFile(): string {
    return join(this.opts.dataDir, `${DEEPSEEK_USAGE_ID}-state.json`);
  }

  private loadState(): void {
    try {
      if (!existsSync(this.stateFile())) return;
      const raw = JSON.parse(readFileSync(this.stateFile(), 'utf8')) as Partial<StateFile>;
      this.state = { snapshots: raw.snapshots ?? {}, below: raw.below ?? {}, reported: raw.reported ?? {} };
    } catch { /* 文件坏了就从空状态开始 */ }
  }

  private saveState(): void {
    try {
      writeFileSync(this.stateFile(), JSON.stringify(this.state), 'utf8');
    } catch (err) {
      this.log?.warn('deepseek-usage 状态文件写入失败', { err: String(err) });
    }
  }
}

function asQueryError(err: unknown): QueryError {
  return err instanceof QueryError ? err : new QueryError('network', null, String((err as Error)?.message ?? err));
}
