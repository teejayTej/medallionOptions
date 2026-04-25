import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_BACKUP = { ...process.env };

beforeEach(() => {
  process.env.POLYGON_API_KEY = 'test_key';
  process.env.POLYGON_PLAN_TIER = 'developer';
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ENV_BACKUP };
  vi.restoreAllMocks();
});

describe('getOptionTrades', () => {
  it('returns array of trades with expected shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [
              { sip_timestamp: 1777060783569226860, price: 1.4, size: 2, exchange: 302, conditions: [227] },
              { sip_timestamp: 1777059947022647037, price: 1.36, size: 5, exchange: 302, conditions: [233] },
            ],
            status: 'DELAYED',
          }),
          { status: 200 },
        ),
      ),
    );

    const { getOptionTrades } = await import('@/lib/data/polygon');
    const trades = await getOptionTrades('O:SPY260501C00600000', { limit: 100 });

    expect(trades).toHaveLength(2);
    expect(trades[0]).toMatchObject({
      sip_timestamp: 1777060783569226860,
      price: 1.4,
      size: 2,
      exchange: 302,
      conditions: [227],
    });
  });

  it('paginates via next_url when present', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [{ sip_timestamp: 1, price: 1.0, size: 1, exchange: 0, conditions: [] }],
          next_url: 'https://api.polygon.io/v3/trades/O:X?cursor=abc',
          status: 'DELAYED',
        }),
        { status: 200 },
      ),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: [{ sip_timestamp: 2, price: 2.0, size: 2, exchange: 0, conditions: [] }],
          status: 'DELAYED',
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getOptionTrades } = await import('@/lib/data/polygon');
    const trades = await getOptionTrades('O:X', { limit: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(trades).toHaveLength(2);
    expect(trades[0].sip_timestamp).toBe(1);
    expect(trades[1].sip_timestamp).toBe(2);
    const calls = fetchMock.mock.calls as unknown as string[][];
    const secondCall = calls[1][0];
    expect(secondCall).toContain('cursor=abc');
    expect(secondCall).toContain('apiKey=test_key');
  });
});

describe('getContractsIncludingExpired', () => {
  it('returns expired contracts with the expected shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                ticker: 'O:INQ100320C00025000',
                underlying_ticker: 'INTC',
                contract_type: 'call',
                expiration_date: '2010-03-20',
                strike_price: 25,
                shares_per_contract: 100,
                exercise_style: 'american',
                primary_exchange: 'BATO',
                cfi: 'OCASPS',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const { getContractsIncludingExpired } = await import('@/lib/data/polygon');
    const contracts = await getContractsIncludingExpired({
      underlying: 'INTC',
      expiration_date_lte: '2025-06-20',
    });

    expect(contracts.length).toBeGreaterThan(0);
    expect(contracts[0]).toMatchObject({
      ticker: 'O:INQ100320C00025000',
      underlying_ticker: 'INTC',
      contract_type: 'call',
      expiration_date: '2010-03-20',
      strike_price: 25,
    });
  });

  it('sets expired=true and propagates filter params in the request URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getContractsIncludingExpired } = await import('@/lib/data/polygon');
    await getContractsIncludingExpired({
      underlying: 'AAPL',
      expiration_date_gte: '2024-01-01',
      expiration_date_lte: '2024-12-31',
      strike_price_gte: 150,
      strike_price_lte: 200,
      contract_type: 'put',
    });

    const calls = fetchMock.mock.calls as unknown as string[][];
    const calledUrl = calls[0][0];
    expect(calledUrl).toContain('expired=true');
    expect(calledUrl).toContain('underlying_ticker=AAPL');
    expect(calledUrl).toContain('expiration_date.gte=2024-01-01');
    expect(calledUrl).toContain('expiration_date.lte=2024-12-31');
    expect(calledUrl).toContain('strike_price.gte=150');
    expect(calledUrl).toContain('strike_price.lte=200');
    expect(calledUrl).toContain('contract_type=put');
  });
});

describe('plan-tier assertion', () => {
  it('warns when POLYGON_PLAN_TIER is not developer or advanced', async () => {
    process.env.POLYGON_PLAN_TIER = 'starter';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('@/lib/data/polygon');
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls as unknown as string[][];
    expect(calls[0][0]).toContain('POLYGON_PLAN_TIER');
    expect(calls[0][0]).toContain('starter');
  });

  it('does not warn when POLYGON_PLAN_TIER=developer', async () => {
    process.env.POLYGON_PLAN_TIER = 'developer';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('@/lib/data/polygon');
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
