/**
 * 两个页签:「快速配置」登记账户、看余额、填警告线;「定时与提醒」设播报时刻、送达方式、警告线检查与预览。
 *
 * 改动当场经 World 的方法写回(账户表与 key 不在配置 schema 里),不另设保存按钮。key 只在粘贴框里出现，
 * 保存后页面只拿得到打码后的样子。
 */
import type { WebUiClientBundle, WebUiPanel, WebUiPanelContext } from 'cortico/web/shared/client-panel.ts';
import type { AccountView, PanelState, TestResult } from '../panel-state.ts';
import { amount, KEY_URL, READING_NAMES, type Snapshot } from '../readings.ts';
import { isZh, panelText } from './text.ts';
import './style.css';

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const AUTO_TEST_MS = 700;
const KEY_MIN = 16;
const CHECK_CHOICES = [15, 30, 60, 180, 360, 720, 1440];

/** `14:03`,跨天时带日期。 */
function clock(at: number, zh: boolean): string {
  const d = new Date(at);
  const hm = d.toLocaleTimeString(zh ? 'zh-CN' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

/** 大字是第一种币种的余额;其余读数做成小标签。 */
function renderReadings(ctx: WebUiPanelContext, snap: Snapshot): HTMLElement {
  const { ui } = ctx;
  const zh = isZh(ctx.language);
  const t = panelText(ctx.language);
  const name = (k: keyof typeof READING_NAMES) => (zh ? READING_NAMES[k].zh : READING_NAMES[k].en);
  const box = ui.h('div', 'au-readings');
  const head = snap.primary;
  if (head) {
    const big = ui.h('div', 'au-big');
    big.append(ui.h('span', 'au-big-v', amount(head.value)), ui.h('span', 'au-big-u', head.currency));
    box.append(ui.h('div', 'au-big-k', name('total')), big);
  }
  const chips = ui.h('div', 'au-chips');
  for (const r of snap.readings) {
    if (head && r.key === head.key && r.currency === head.currency) continue;
    chips.append(ui.chip(`${name(r.key)} ${amount(r.value)}${r.currency !== head?.currency ? ` ${r.currency}` : ''}`));
  }
  chips.append(ui.chip(t.usable(snap.usable), snap.usable ? 'plain' : 'warn'));
  box.append(chips);
  return box;
}

// ---------------------------------------------------------------- 快速配置

const quickPanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const { ui } = ctx;
    const t = panelText(ctx.language);
    const zh = isZh(ctx.language);

    // 账户与警告线变了，页头的徽标也跟着重读
    const call = async (method: string, args: unknown[] = []): Promise<boolean> => {
      try { render(await ctx.invoke<PanelState>(method, args)); void ctx.refresh(); return true; } catch (err) { ui.toast(errText(err), 'bad'); return false; }
    };

    // ------------------------------------------------------------ 账户
    const list = ui.sheet({ title: t.accounts, desc: t.accountsDesc });
    const listActions = ui.rowbar();
    const refreshAll = ui.button(t.refreshAll, { size: 'sm', onClick: () => void (async () => { const off = ui.disable(refreshAll); await call('refresh'); off.dispose(); })() });
    listActions.append(refreshAll);
    const cards = ui.h('div', 'au-cards');
    list.body.append(cards, listActions);

    function statusPill(a: AccountView): HTMLElement {
      if (!a.masked) return ui.pill(t.noKey, 'off');
      if (a.error) return ui.pill(t.failed, 'off');
      if (a.below) return ui.chip(t.below, 'warn');
      return ui.pill(t.ok, 'on');
    }

    function card(a: AccountView): HTMLElement {
      const el = ui.h('div', `au-card${a.below ? ' au-low' : ''}`);

      const head = ui.h('div', 'au-row au-head');
      const name = ui.h('strong', 'au-name', a.label);
      head.append(name, statusPill(a), ui.h('span', 'au-meta', a.masked ?? ''));
      el.append(head);

      if (a.snapshot) el.append(renderReadings(ctx, a.snapshot));
      if (a.error) el.append(ui.msgline(a.error, true));

      // 警告线:回车或失焦即保存;清空为不设
      const foot = ui.h('div', 'au-row au-foot');
      const warn = ui.input({
        type: 'number', cls: 'au-warn', value: a.warnBelow === null ? '' : String(a.warnBelow), placeholder: t.warnPlaceholder,
        onCommit: (v) => void saveWarn(a, v), onChange: (v) => void saveWarn(a, v),
      });
      warn.title = t.warnHint;
      const field = ui.h('label', 'au-warnfield');
      field.append(ui.h('span', 'au-note', t.warn), warn, ui.h('span', 'au-note', a.snapshot?.primary?.currency ?? ''));
      foot.append(field);
      foot.append(ui.h('span', 'au-note au-time', a.snapshot ? t.readAt(clock(a.snapshot.at, zh)) : t.never));
      const refresh = ui.button(t.refresh, { size: 'sm', onClick: () => void (async () => { const off = ui.disable(refresh); await call('refresh', [a.id]); off.dispose(); })() });
      const rename = ui.button(t.rename, { size: 'sm', onClick: () => startRename(a, head, name) });
      const change = ui.button(t.changeKey, { size: 'sm', onClick: () => startReplace(a, el, change) });
      const remove = ui.button(t.remove, { size: 'sm', variant: 'danger', onClick: () => void removeAccount(a) });
      foot.append(refresh, rename, change, remove);
      el.append(foot);
      return el;
    }

    let lastWarn = new Map<string, string>();
    async function saveWarn(a: AccountView, raw: string) {
      const v = raw.trim();
      if ((lastWarn.get(a.id) ?? (a.warnBelow === null ? '' : String(a.warnBelow))) === v) return;
      lastWarn.set(a.id, v);
      if (v !== '' && !Number.isFinite(Number(v))) return;
      if (await call('setWarn', [a.id, v === '' ? null : Number(v)])) ui.toast(v === '' ? t.warnCleared : t.warnSaved);
    }

    function startRename(a: AccountView, head: HTMLElement, name: HTMLElement) {
      const input = ui.input({ value: a.label, cls: 'au-rename', onCommit: (v) => void finish(v) });
      const done = ui.button(t.save, { size: 'sm', variant: 'primary', onClick: () => void finish(input.value) });
      const cancel = ui.button(t.cancel, { size: 'sm', onClick: () => { input.remove(); done.remove(); cancel.remove(); name.hidden = false; } });
      name.hidden = true;
      head.prepend(input, done, cancel);
      input.focus();
      input.select();
      async function finish(v: string) {
        if (!v.trim() || v.trim() === a.label) { cancel.click(); return; }
        if (await call('setLabel', [a.id, v.trim()])) ui.toast(t.saved);
      }
    }

    function startReplace(a: AccountView, el: HTMLElement, trigger: HTMLButtonElement) {
      trigger.disabled = true;
      const row = ui.h('div', 'au-row au-replace');
      const input = ui.input({ type: 'password', cls: 'mono au-key', placeholder: t.newKeyFor(a.label), onCommit: () => void go() });
      const ok = ui.button(t.replace, { size: 'sm', variant: 'primary', onClick: () => void go() });
      const cancel = ui.button(t.cancel, { size: 'sm', onClick: () => { row.remove(); trigger.disabled = false; } });
      row.append(input, ok, cancel);
      el.append(row);
      input.focus();
      async function go() {
        if (!input.value.trim()) return;
        const off = ui.disable(ok, input);
        const done = await call('replaceKey', [a.id, input.value.trim()]);
        off.dispose();
        if (done) ui.toast(t.replaced);
      }
    }

    async function removeAccount(a: AccountView) {
      if (!(await ui.confirm({ title: t.removeTitle(a.label), body: t.removeBody, danger: true }))) return;
      if (await call('remove', [a.id])) ui.toast(t.removed);
    }

    function render(state: PanelState) {
      lastWarn = new Map();
      cards.replaceChildren(...(state.accounts.length ? state.accounts.map(card) : [ui.placeholder(t.empty)]));
      refreshAll.hidden = !state.accounts.length;
    }

    // ------------------------------------------------------------ 添加
    const addSheet = ui.sheet({ title: t.add, desc: t.addDesc });
    let passed: string | null = null;

    const keyLink = ui.h('a', 'au-link', t.getKey);
    keyLink.href = KEY_URL;
    keyLink.target = '_blank';
    keyLink.rel = 'noopener noreferrer';
    const keyInput = ui.input({ type: 'password', cls: 'mono au-key', placeholder: t.keyPlaceholder, onInput: () => retest(), onCommit: () => void test() });
    const testBtn = ui.button(t.test, { size: 'sm', onClick: () => void test() });
    const keyRow = ui.h('div', 'au-row');
    keyRow.append(keyInput, testBtn, keyLink);
    const testOut = ui.h('div', 'au-test');

    const labelInput = ui.input({ cls: 'au-label', placeholder: 'DeepSeek' });
    const warnInput = ui.input({ type: 'number', cls: 'au-warn', placeholder: t.warnPlaceholder });
    const warnUnit = ui.h('span', 'au-note');
    const warnBox = ui.h('div', 'au-row');
    warnBox.append(warnInput, warnUnit);
    const saveBtn = ui.button(t.save, { variant: 'primary', onClick: () => void save() });
    const saveNote = ui.h('span', 'au-note', t.testFirst);
    const saveRow = ui.actions();
    saveRow.append(saveBtn, saveNote);

    addSheet.body.append(ui.field(t.key, keyRow), testOut, ui.field(t.label, labelInput), ui.field(t.warn, warnBox), saveRow);

    const isPassed = () => passed !== null && passed === keyInput.value.trim();
    function paintSave() {
      saveBtn.disabled = !isPassed();
      saveNote.hidden = isPassed();
    }

    let timer: { dispose(): void } | null = null;
    let seq = 0;
    function retest() {
      timer?.dispose();
      testOut.replaceChildren();
      paintSave();
      if (keyInput.value.trim().length >= KEY_MIN) timer = ctx.timeout(() => void test(), AUTO_TEST_MS);
    }
    async function test() {
      const key = keyInput.value.trim();
      if (!key) return;
      const mine = ++seq;
      testOut.replaceChildren(ui.h('span', 'au-note', t.testing));
      let res: TestResult;
      try { res = await ctx.invoke<TestResult>('test', [key]); } catch (err) { res = { ok: false, error: errText(err) }; }
      if (mine !== seq) return;
      testOut.replaceChildren(res.ok ? renderReadings(ctx, res.snapshot) : ui.msgline(res.error, true));
      passed = res.ok ? key : null;
      warnUnit.textContent = res.ok ? res.snapshot.primary?.currency ?? '' : '';
      paintSave();
    }
    async function save() {
      if (!isPassed()) return;
      const warn = warnInput.value.trim();
      const off = ui.disable(saveBtn, keyInput, testBtn);
      const ok = await call('add', [{ key: keyInput.value.trim(), label: labelInput.value.trim(), warnBelow: warn && Number.isFinite(Number(warn)) ? Number(warn) : null }]);
      off.dispose();
      if (!ok) return;
      ui.toast(t.saved);
      keyInput.value = '';
      labelInput.value = '';
      warnInput.value = '';
      warnUnit.textContent = '';
      passed = null;
      testOut.replaceChildren();
      paintSave();
    }

    ctx.root.append(list.el, addSheet.el);
    paintSave();
    void (async () => {
      try { render(await ctx.invoke<PanelState>('state')); } catch (err) { ui.toast(errText(err), 'bad'); return; }
      await call('read');
    })();
  },
};

// ---------------------------------------------------------------- 定时与提醒

const schedulePanel: WebUiPanel = {
  mount(ctx: WebUiPanelContext) {
    const { ui } = ctx;
    const t = panelText(ctx.language);
    let state: PanelState | null = null;

    const call = async (method: string, args: unknown[] = []): Promise<boolean> => {
      try { render(await ctx.invoke<PanelState>(method, args)); return true; } catch (err) { ui.toast(errText(err), 'bad'); return false; }
    };
    const setSchedule = async (patch: Record<string, unknown>) => { if (await call('setSchedule', [patch])) { ui.toast(t.savedSetting); void loadPreview(); } };

    // ------------------------------------------------------------ 定时播报
    const sched = ui.sheet({ title: t.schedule, desc: t.scheduleDesc });
    const on = ui.checkbox(t.scheduleOn, { onChange: (v) => void setSchedule({ enabled: v }) });
    const chips = ui.h('div', 'au-chips');
    const timeInput = ui.input({ cls: 'au-time-input', onCommit: () => void addTime() });
    timeInput.type = 'time';
    const addBtn = ui.button(t.addTime, { size: 'sm', onClick: () => void addTime() });
    const timeRow = ui.h('div', 'au-row');
    timeRow.append(chips, timeInput, addBtn);
    const delivery = ui.segmented([{ value: 'wake', label: t.wake }, { value: 'ride', label: t.ride }], { size: 'sm', onSelect: (v) => void setSchedule({ wake: v === 'wake' }) });
    const nextLine = ui.h('div', 'au-note');
    sched.body.append(on.el, ui.field(t.times, timeRow), ui.field(t.delivery, delivery.el), nextLine);

    async function addTime() {
      const v = timeInput.value.trim();
      if (!/^\d{1,2}:\d{2}$/.test(v) || !state) return;
      timeInput.value = '';
      await setSchedule({ times: [...state.schedule.times, v.padStart(5, '0')], enabled: true });
    }

    // ------------------------------------------------------------ 警告线
    const alerts = ui.sheet({ title: t.alerts, desc: t.alertsDesc });
    const lines = ui.h('div', 'au-lines');
    const every = ui.select({ onChange: (v) => void (async () => { if (await call('setAlerts', [{ checkMinutes: Number(v) }])) ui.toast(t.savedSetting); })() });
    const alertDelivery = ui.segmented([{ value: 'wake', label: t.wake }, { value: 'ride', label: t.ride }], {
      size: 'sm', onSelect: (v) => void (async () => { if (await call('setAlerts', [{ wake: v === 'wake' }])) ui.toast(t.savedSetting); })(),
    });
    alerts.body.append(lines, ui.field(t.checkEvery, every), ui.field(t.delivery, alertDelivery.el));

    // ------------------------------------------------------------ 预览
    const preview = ui.sheet({ title: t.preview, desc: t.previewDesc });
    const pre = ui.h('pre', 'au-preview mono');
    const previewActions = ui.actions();
    const refreshBtn = ui.button(t.refreshPreview, { size: 'sm', onClick: () => void loadPreview() });
    const sendBtn = ui.button(t.sendNow, { size: 'sm', variant: 'primary', onClick: () => void sendNow() });
    previewActions.append(refreshBtn, sendBtn);
    preview.body.append(pre, previewActions);

    async function loadPreview() {
      pre.textContent = t.testing;
      try { pre.textContent = await ctx.invoke<string>('preview'); } catch (err) { pre.textContent = errText(err); }
    }
    async function sendNow() {
      if (!(await ui.confirm({ title: t.sendTitle, body: t.sendBody }))) return;
      const off = ui.disable(sendBtn);
      try { pre.textContent = await ctx.invoke<string>('sendNow'); ui.toast(t.sent); } catch (err) { ui.toast(errText(err), 'bad'); }
      off.dispose();
    }

    function render(s: PanelState) {
      state = s;
      on.setChecked(s.schedule.enabled);
      chips.replaceChildren(...(s.schedule.times.length ? s.schedule.times.map((time) => {
        const chip = ui.h('span', 'au-timechip');
        const x = ui.h('button', 'au-x', '×');
        x.type = 'button';
        x.title = t.remove;
        x.addEventListener('click', () => void setSchedule({ times: s.schedule.times.filter((v) => v !== time) }), { signal: ctx.signal });
        chip.append(ui.h('span', null, time), x);
        return chip;
      }) : [ui.h('span', 'au-note', t.noTimes)]));
      delivery.setValue(s.schedule.wake ? 'wake' : 'ride');
      nextLine.textContent = [s.schedule.next ? t.next(s.schedule.next.day, s.schedule.next.time) : t.off, t.timezone(s.timezone)].join(' · ');

      const watched = s.accounts.filter((a) => a.warnBelow !== null);
      if (!watched.length) lines.replaceChildren(ui.placeholder(t.noLines));
      else {
        const table = ui.table({ head: [t.accounts, t.warn, t.current, ''] });
        for (const a of watched) {
          const p = a.snapshot?.primary ?? null;
          const unit = p?.currency ?? '';
          table.addRow([a.label, `${amount(a.warnBelow!)} ${unit}`, p ? `${amount(p.value)} ${unit}` : '–', a.error ? ui.pill(t.failed, 'off') : a.below ? ui.chip(t.below, 'warn') : ui.pill(t.ok, 'on')]);
        }
        lines.replaceChildren(table.el);
      }
      const choices = CHECK_CHOICES.includes(s.alerts.checkMinutes) ? CHECK_CHOICES : [...CHECK_CHOICES, s.alerts.checkMinutes].sort((a, b) => a - b);
      every.replaceChildren(...choices.map((n) => {
        const o = document.createElement('option');
        o.value = String(n);
        o.textContent = t.everyMin(n);
        o.selected = n === s.alerts.checkMinutes;
        return o;
      }));
      alertDelivery.setValue(s.alerts.wake ? 'wake' : 'ride');
    }

    ctx.root.append(sched.el, alerts.el, preview.el);
    void (async () => {
      if (await call('state')) await loadPreview();
    })();
  },
};

export default { panels: { quick: quickPanel, schedule: schedulePanel } } satisfies WebUiClientBundle;
