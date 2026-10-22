import { describe, expect, it } from 'vitest';
import { QueryError, queryBalance, type FetchLike } from '../src/deepseek.ts';
import { amount } from '../src/readings.ts';

// 官方文档的响应示例(api-docs.deepseek.com,2026-10-21 读)
const DOC_EXAMPLE = { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' }] };
const KEY = 'sk-test-0123456789abcdef';

function serve(status: number, body: unknown, seen: string[] = []): FetchLike {
  return async (url, init) => {
    seen.push(`${url} ${(init.headers as Record<string, string>).authorization}`);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

describe('queryBalance', () => {
  it('reads the documented example', async () => {
    const seen: string[] = [];
    const snap = await queryBalance(KEY, serve(200, DOC_EXAMPLE, seen), 1);
    expect(seen).toEqual([`https://api.deepseek.com/user/balance Bearer ${KEY}`]);
    expect(snap.primary).toEqual({ key: 'total', value: 110, currency: 'CNY' });
    expect(snap.readings.map((r) => [r.key, r.value])).toEqual([['total', 110], ['granted', 10], ['toppedUp', 100]]);
    expect(snap.usable).toBe(true);
  });

  it('keeps every currency the account has', async () => {
    const snap = await queryBalance(KEY, serve(200, { ...DOC_EXAMPLE, balance_infos: [...DOC_EXAMPLE.balance_infos, { currency: 'USD', total_balance: '2.50', granted_balance: '0.00', topped_up_balance: '2.50' }] }), 1);
    expect(snap.readings.filter((r) => r.key === 'total').map((r) => r.currency)).toEqual(['CNY', 'USD']);
  });

  it('classifies a rejected key and keeps the key out of the message', async () => {
    const err = await queryBalance(KEY, serve(401, { error: { message: `Authentication Fails, Your api key: ${KEY} is invalid` } }), 1).catch((e) => e);
    expect(err).toBeInstanceOf(QueryError);
    expect(err).toMatchObject({ kind: 'auth', status: 401 });
    expect(err.detail).not.toContain(KEY);
  });

  it('reports an unexpected body as a format error', async () => {
    await expect(queryBalance(KEY, serve(200, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: 'n/a' }] }), 1)).rejects.toMatchObject({ kind: 'format' });
    await expect(queryBalance(KEY, serve(200, '<html>'), 1)).rejects.toMatchObject({ kind: 'format' });
  });
});

describe('amount', () => {
  it('keeps small amounts readable', () => {
    expect([amount(110), amount(0.5), amount(0.0034), amount(-3.00001), amount(0)]).toEqual(['110.00', '0.50', '0.0034', '-3.00', '0.00']);
  });
});
