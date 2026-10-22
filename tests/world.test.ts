import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dryMountWorld } from 'cortico/extensions/dry-mount.ts';
import { DEEPSEEK_USAGE_DEFAULTS, secretName, type DeepseekUsageConfigSection } from '../src/config.ts';
import type { FetchLike } from '../src/deepseek.ts';
import { DEEPSEEK_USAGE } from '../src/definition.ts';
import type { PanelState } from '../src/panel-state.ts';
import { DeepseekUsageWorld } from '../src/world.ts';
import { FakeHost } from './helpers/fake-host.ts';

const TZ = 'Asia/Shanghai';
const KEY = 'sk-test-0123456789abcdef';
/** 2026-10-21 08:00 北京时间。 */
const MORNING = Date.parse('2026-10-21T00:00:00Z');
const MIN = 60_000;

const tmp = () => mkdtempSync(join(tmpdir(), 'deepseek-usage-'));

/** 假的 DeepSeek:余额可改,key 不对回 401。 */
class Upstream {
  balance = 110;
  calls = 0;
  fetch: FetchLike = async (_url, init) => {
    this.calls++;
    const auth = (init.headers as Record<string, string>).authorization;
    if (auth !== `Bearer ${KEY}`) return new Response(JSON.stringify({ error: { message: 'Authentication Fails' } }), { status: 401 });
    const b = this.balance.toFixed(2);
    return new Response(JSON.stringify({ is_available: this.balance > 0, balance_infos: [{ currency: 'CNY', total_balance: b, granted_balance: '0.00', topped_up_balance: b }] }));
  };
}

function setup(dir = tmp(), cfg: DeepseekUsageConfigSection = { ...structuredClone(DEEPSEEK_USAGE_DEFAULTS), enabled: true }, secrets = new Map<string, string>()) {
  const up = new Upstream();
  const clock = { now: MORNING };
  const w = new DeepseekUsageWorld({
    cfg,
    timezone: TZ,
    dataDir: dir,
    secret: (n) => secrets.get(n) ?? '',
    storeSecret: (n, v) => { if (v) secrets.set(n, v); else secrets.delete(n); },
    persist: (patch) => {
      for (const [k, v] of Object.entries(patch)) {
        const cur = (cfg as unknown as Record<string, unknown>)[k];
        (cfg as unknown as Record<string, unknown>)[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(cur as object), ...v } : v;
      }
    },
    fetch: up.fetch,
    now: () => clock.now,
    tickMs: 1e9,
  });
  return { w, up, clock, cfg, secrets, dir };
}

const call = async (w: DeepseekUsageWorld, name: string, args: Record<string, unknown> = {}) =>
  String(await w.tools().find((t) => t.name === name)!.handler(args, {} as never));

describe('DeepSeek Usage World', () => {
  it('mounts dry with its defaults', async () => {
    const report = await dryMountWorld(DEEPSEEK_USAGE, { scratchDir: tmp() });
    expect(report.failures).toEqual([]);
  });

  it('lets the bot register an account only with a key that reads, and never echoes the key', async () => {
    const { w, secrets, cfg } = setup();
    expect(await call(w, 'deepseek_usage_add_account', { key: 'sk-wrong-key-000000' })).toContain('没有登记');
    expect(cfg.accounts).toEqual([]);

    const out = await call(w, 'deepseek_usage_add_account', { key: KEY, label: '主号' });
    expect(out).toContain('已登记账户「主号」[main]');
    expect(out).toContain('余额 110.00 CNY');
    expect(out).not.toContain(KEY);
    expect(secrets.get(secretName('main'))).toBe(KEY);
    expect(cfg.accounts).toEqual([{ id: 'main', label: '主号', warnBelow: null }]);

    await call(w, 'deepseek_usage_add_account', { key: KEY });
    expect(cfg.accounts.map((a) => [a.id, a.label])).toEqual([['main', '主号'], ['account-2', 'DeepSeek']]);
  });

  it('reuses a reading within the cache time and reads again after it', async () => {
    const { w, up, clock } = setup();
    await call(w, 'deepseek_usage_add_account', { key: KEY });
    up.calls = 0;
    await call(w, 'deepseek_usage_check');
    expect(up.calls).toBe(0);
    up.balance = 99;
    clock.now += 61_000;
    expect(await call(w, 'deepseek_usage_check', { account: 'main' })).toContain('余额 99.00 CNY');
    expect(up.calls).toBe(1);
    expect(await call(w, 'deepseek_usage_check', { account: 'nope' })).toContain('没有叫「nope」的账户');
  });

  it('alerts once when the balance drops below the line, and again only after it went back above', async () => {
    const { w, up, clock } = setup();
    const host = new FakeHost();
    await w.start(host);
    await call(w, 'deepseek_usage_add_account', { key: KEY, warn_below: 20 });
    const lows = () => host.events.filter((e) => e.type === 'deepseek-usage.low');

    const step = async (balance: number) => {
      up.balance = balance;
      clock.now += 61 * MIN;
      await w.tick();
    };
    await step(18);
    await step(15);
    expect(lows().map((e) => e.text)).toEqual(['DeepSeek 余额 18.00 CNY,低于警告线 20.00 CNY(10-21 09:01 查询)']);
    expect(host.pushOpts.at(-1)).toEqual({ trigger: 'flush' });
    await step(50);
    await step(10);
    expect(lows()).toHaveLength(2);
    await w.stop();
  });

  it('sends the scheduled report once per time and day, also across a restart, and skips a time missed by far', async () => {
    const dir = tmp();
    const secrets = new Map<string, string>();
    const cfg = { ...structuredClone(DEEPSEEK_USAGE_DEFAULTS), enabled: true };
    const first = setup(dir, cfg, secrets);
    await call(first.w, 'deepseek_usage_add_account', { key: KEY });
    expect(await call(first.w, 'deepseek_usage_set_schedule', { times: ['9:00', '21:00'], wake: true })).toContain('每天 09:00、21:00,叫醒你');

    const host = new FakeHost();
    await first.w.start(host);
    first.clock.now = MORNING + 62 * MIN; // 09:02
    await first.w.tick();
    await first.w.tick();
    const reports = host.events.filter((e) => e.type === 'deepseek-usage.report');
    expect(reports).toHaveLength(1);
    expect(reports[0]!.text).toMatch(/^DeepSeek 余额定时播报\(10-21 09:02\)\nDeepSeek \[main\]/);
    expect(host.pushOpts[host.events.indexOf(reports[0]!)]).toEqual({ trigger: 'flush' });
    await first.w.stop();

    const again = setup(dir, cfg, secrets);
    const host2 = new FakeHost();
    await again.w.start(host2);
    again.clock.now = MORNING + 65 * MIN; // 09:05,今天的 09:00 已发过
    await again.w.tick();
    again.clock.now = MORNING + 13 * 60 * MIN + 30 * MIN; // 21:30,错过太久
    await again.w.tick();
    expect(host2.events.filter((e) => e.type === 'deepseek-usage.report')).toEqual([]);
    await again.w.stop();
  });

  it('edits and removes accounts for the bot', async () => {
    const { w, cfg, secrets } = setup();
    await call(w, 'deepseek_usage_add_account', { key: KEY });
    expect(await call(w, 'deepseek_usage_edit_account', { account: 'DeepSeek', label: '公司', warn_below: 30 })).toBe('账户「公司」:改名为「公司」;警告线设为 30.00 CNY');
    expect(cfg.accounts[0]).toMatchObject({ label: '公司', warnBelow: 30 });
    expect(await call(w, 'deepseek_usage_edit_account', { account: '公司', clear_warning: true })).toContain('去掉了警告线');
    expect(await call(w, 'deepseek_usage_edit_account', { account: 'main', remove: true })).toBe('已删除账户「公司」和它的 key。');
    expect(cfg.accounts).toEqual([]);
    expect(secrets.size).toBe(0);
  });

  it('gives the panel masked keys and the failure of the last read', async () => {
    const { w, secrets } = setup();
    await call(w, 'deepseek_usage_add_account', { key: KEY });
    secrets.set(secretName('main'), 'sk-revoked-key-00000000');
    const state = await w.invoke('quick', 'refresh', ['zh']) as PanelState;
    expect(state.accounts[0]).toMatchObject({ masked: 'sk-rev…0000', error: 'key 无效或没有查询权限(HTTP 401):Authentication Fails' });
    expect(state.accounts[0]!.snapshot?.primary?.value).toBe(110);
    expect(JSON.stringify(state)).not.toContain('sk-revoked-key-00000000');
  });
});
