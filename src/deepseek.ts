/**
 * 向 DeepSeek 查一次余额:`GET https://api.deepseek.com/user/balance`,用推理的同一把 key。
 * 字段按官方文档(api-docs.deepseek.com,2026-10-21 读):`is_available`,`balance_infos[]` 每种币种一项，金额是字符串。
 * 失败抛 `QueryError`,消息里不带 key。
 */
import type { Reading, Snapshot } from './readings.ts';

const URL_BALANCE = 'https://api.deepseek.com/user/balance';
const TIMEOUT_MS = 15_000;
/** 失败原因里转述服务商错误消息的最大长度。 */
const DETAIL_MAX = 160;

/** `nokey`:部署 `.env` 里没有这个账户的 key,`detail` 是密钥名。 */
export type QueryErrorKind = 'nokey' | 'auth' | 'http' | 'network' | 'format';

export class QueryError extends Error {
  constructor(readonly kind: QueryErrorKind, readonly status: number | null, readonly detail: string) {
    super(`${kind}${status ? ` ${status}` : ''}: ${detail}`);
    this.name = 'QueryError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function queryBalance(key: string, fetchImpl: FetchLike, now: number): Promise<Snapshot> {
  const secret = key.trim();
  let res: Response;
  try {
    res = await fetchImpl(URL_BALANCE, {
      headers: { authorization: `Bearer ${secret}`, accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    throw new QueryError('network', null, `api.deepseek.com: ${e.name === 'TimeoutError' ? 'timeout' : e.cause?.code ?? e.cause?.message ?? e.message}`);
  }
  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* 非 JSON 按格式错误处理 */ }
  if (!res.ok) {
    const detail = redact(errorMessage(body) ?? text.slice(0, DETAIL_MAX), secret);
    throw new QueryError(res.status === 401 || res.status === 403 ? 'auth' : 'http', res.status, detail);
  }
  if (body === null) throw new QueryError('format', res.status, redact(text.slice(0, DETAIL_MAX), secret));
  return { at: now, ...parseBalance(body) };
}

export function parseBalance(body: unknown): Omit<Snapshot, 'at'> {
  const b = body as { is_available?: unknown; balance_infos?: unknown };
  if (!Array.isArray(b?.balance_infos)) throw shape('balance_infos');
  if (typeof b.is_available !== 'boolean') throw shape('is_available');
  const readings: Reading[] = [];
  for (const item of b.balance_infos as Array<Record<string, unknown>>) {
    const currency = item?.currency;
    if (currency !== 'CNY' && currency !== 'USD') throw shape(`currency ${String(currency)}`);
    readings.push(
      { key: 'total', value: num(item.total_balance, 'total_balance'), currency },
      { key: 'granted', value: num(item.granted_balance, 'granted_balance'), currency },
      { key: 'toppedUp', value: num(item.topped_up_balance, 'topped_up_balance'), currency },
    );
  }
  return { readings, primary: readings[0] ?? null, usable: b.is_available };
}

function num(v: unknown, field: string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw shape(field);
  return n;
}

const shape = (field: string) => new QueryError('format', null, `unexpected ${field}`);

/** 错误体里的那句话:`{error:{message}}`、`{error:"..."}`、`{message}`。 */
function errorMessage(body: unknown): string | null {
  const b = body as { error?: unknown; message?: unknown } | null;
  const e = b?.error;
  const msg = typeof e === 'string' ? e : typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : typeof b?.message === 'string' ? b.message : null;
  return msg ? msg.slice(0, DETAIL_MAX) : null;
}

function redact(text: string, key: string): string {
  return key.length >= 8 ? text.split(key).join('***') : text;
}
