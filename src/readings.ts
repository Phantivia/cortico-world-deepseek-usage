/**
 * 读数的形状、名字和金额写法。不 import 任何东西:服务端与面板共用。
 */

export type Currency = 'CNY' | 'USD';
export type ReadingKey = 'total' | 'granted' | 'toppedUp';

export interface Reading {
  key: ReadingKey;
  value: number;
  currency: Currency;
}

export interface Snapshot {
  /** 查询时刻,epoch 毫秒。 */
  at: number;
  /** 每种币种依次是余额、赠金、充值。 */
  readings: Reading[];
  /** 警告线比较的那一项：第一种币种的余额;服务商一种币种都没给时为 null。 */
  primary: Reading | null;
  /** DeepSeek 说的「余额够不够调用」。 */
  usable: boolean;
}

export const KEY_URL = 'https://platform.deepseek.com/api_keys';

export const READING_NAMES: Record<ReadingKey, { zh: string; en: string }> = {
  total: { zh: '余额', en: 'Balance' },
  granted: { zh: '其中赠金', en: 'granted' },
  toppedUp: { zh: '其中充值', en: 'topped up' },
};

/** 金额:绝对值 1 以上两位小数;以下留到第一位有效数字后一位，至少两位、最多六位小数。 */
export function amount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1 || abs === 0) return value.toFixed(2);
  const digits = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(abs))));
  return value.toFixed(digits).replace(/(\.\d{2,}?)0+$/, '$1');
}

export const money = (value: number, currency: Currency): string => `${amount(value)} ${currency}`;

/** key 只露前 6 后 4 位。 */
export function maskKey(key: string): string {
  const k = key.trim();
  return k.length <= 12 ? `${k.slice(0, 2)}…` : `${k.slice(0, 6)}…${k.slice(-4)}`;
}

/** `09:00, 21:30` → 去重排序后的合法时刻;认不出的项丢掉。 */
export function parseTimes(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.split(/[,，\s]+/)) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
    if (!m) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    out.add(`${String(h).padStart(2, '0')}:${m[2]}`);
  }
  return [...out].sort();
}
