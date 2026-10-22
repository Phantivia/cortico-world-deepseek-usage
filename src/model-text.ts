/** 发给模型的文字:工具回执与事件正文，按 `promptLanguage` 取中文或英文。 */
import type { QueryError } from './deepseek.ts';
import { amount, money, READING_NAMES, type Currency, type Snapshot } from './readings.ts';

export interface ModelText {
  zh: boolean;
  head(label: string, id: string, at: string): string;
  failed(label: string, id: string, reason: string): string;
  error(e: QueryError): string;
  usable(ok: boolean): string;
  warnLine(value: number, currency: Currency | null): string;
  noAccounts: string;
  noSuchAccount(name: string, ids: string): string;
  reportHead(at: string): string;
  low(label: string, reading: string, line: string, at: string): string;
  added(label: string, id: string, masked: string): string;
  addFailed(reason: string): string;
  edited(label: string, changes: string[]): string;
  removed(label: string): string;
  renamed(label: string): string;
  warnSet(line: string): string;
  warnCleared: string;
  nothingToEdit: string;
  schedule(times: string[], wake: boolean): string;
  badTimes(raw: string): string;
}

const ZH: ModelText = {
  zh: true,
  head: (label, id, at) => `${label} [${id}] · ${at} 查询`,
  failed: (label, id, reason) => `${label} [${id}] · 查询失败:${reason}`,
  error: (e) => {
    const status = e.status ? `(HTTP ${e.status})` : '';
    switch (e.kind) {
      case 'nokey': return `部署 .env 里没有 ${e.detail}`;
      case 'auth': return `key 无效或没有查询权限${status}${e.detail ? `:${e.detail}` : ''}`;
      case 'http': return `DeepSeek 返回错误${status}${e.detail ? `:${e.detail}` : ''}`;
      case 'network': return `连不上 ${e.detail}`;
      case 'format': return `返回的格式认不出(${e.detail})`;
    }
  },
  usable: (ok) => `- 余额${ok ? '够' : '不够'}调用`,
  warnLine: (v, c) => `- 警告线 ${c ? money(v, c) : amount(v)}`,
  noAccounts: '还没有登记 DeepSeek 账户。',
  noSuchAccount: (name, ids) => `没有叫「${name}」的账户。已登记:${ids || '无'}`,
  reportHead: (at) => `DeepSeek 余额定时播报(${at})`,
  low: (label, reading, line, at) => `${label} ${reading},低于警告线 ${line}(${at} 查询)`,
  added: (label, id, masked) => `已登记账户「${label}」[${id}],key ${masked} 存进了部署 .env。`,
  addFailed: (reason) => `没有登记:用这把 key 查询失败,${reason}`,
  edited: (label, changes) => `账户「${label}」:${changes.join(';')}`,
  removed: (label) => `已删除账户「${label}」和它的 key。`,
  renamed: (label) => `改名为「${label}」`,
  warnSet: (line) => `警告线设为 ${line}`,
  warnCleared: '去掉了警告线',
  nothingToEdit: '没有要改的项。',
  schedule: (times, wake) => (times.length ? `定时播报:每天 ${times.join('、')},${wake ? '叫醒你' : '随下一批事件送达'}。` : '定时播报已关闭。'),
  badTimes: (raw) => `认不出的时刻:${raw}。要 HH:MM。`,
};

const EN: ModelText = {
  zh: false,
  head: (label, id, at) => `${label} [${id}] · read ${at}`,
  failed: (label, id, reason) => `${label} [${id}] · read failed: ${reason}`,
  error: (e) => {
    const status = e.status ? ` (HTTP ${e.status})` : '';
    switch (e.kind) {
      case 'nokey': return `${e.detail} is not in the deployment .env`;
      case 'auth': return `the key is invalid or may not read the balance${status}${e.detail ? `: ${e.detail}` : ''}`;
      case 'http': return `DeepSeek returned an error${status}${e.detail ? `: ${e.detail}` : ''}`;
      case 'network': return `cannot reach ${e.detail}`;
      case 'format': return `unrecognized response (${e.detail})`;
    }
  },
  usable: (ok) => `- Balance ${ok ? 'is' : 'is not'} enough for calls`,
  warnLine: (v, c) => `- Warning line ${c ? money(v, c) : amount(v)}`,
  noAccounts: 'No DeepSeek accounts registered yet.',
  noSuchAccount: (name, ids) => `No account named "${name}". Registered: ${ids || 'none'}`,
  reportHead: (at) => `Scheduled DeepSeek balance report (${at})`,
  low: (label, reading, line, at) => `${label} ${reading}, below the warning line ${line} (read ${at})`,
  added: (label, id, masked) => `Registered "${label}" [${id}]; key ${masked} is stored in the deployment .env.`,
  addFailed: (reason) => `Not registered: reading with this key failed, ${reason}`,
  edited: (label, changes) => `Account "${label}": ${changes.join('; ')}`,
  removed: (label) => `Removed account "${label}" and its key.`,
  renamed: (label) => `renamed to "${label}"`,
  warnSet: (line) => `warning line set to ${line}`,
  warnCleared: 'warning line cleared',
  nothingToEdit: 'Nothing to change.',
  schedule: (times, wake) => (times.length ? `Scheduled report: daily at ${times.join(', ')}, ${wake ? 'waking you' : 'delivered with the next batch'}.` : 'Scheduled report is off.'),
  badTimes: (raw) => `Unrecognized times: ${raw}. Use HH:MM.`,
};

export const MODEL_TEXT = { zh: ZH, en: EN };

/** 每种币种一行余额(带赠金、充值),再一行够不够调用。 */
export function readingLines(snap: Snapshot, zh: boolean): string[] {
  const name = (k: keyof typeof READING_NAMES) => (zh ? READING_NAMES[k].zh : READING_NAMES[k].en);
  const sep = zh ? ',' : ', ';
  const lines: string[] = [];
  for (const total of snap.readings.filter((r) => r.key === 'total')) {
    const sub = snap.readings.filter((r) => r.key !== 'total' && r.currency === total.currency).map((r) => `${name(r.key)} ${amount(r.value)}`).join(sep);
    lines.push(`- ${name('total')} ${money(total.value, total.currency)}${sub ? (zh ? `(${sub})` : ` (${sub})`) : ''}`);
  }
  lines.push((zh ? ZH : EN).usable(snap.usable));
  return lines;
}
