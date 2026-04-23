export interface StockSnapshot {
  ticker: string;
  price: number;
  prevClose: number;
  changePct: number;
  volume: number;
  timestamp: number;
}

export interface HistoricalBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OptionContract {
  ticker: string;
  underlying: string;
  type: 'call' | 'put';
  strike: number;
  expiration: string;
  dte: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  iv: number;
  impliedVolatility: number;
  openInterest: number;
  volume: number;
  bid: number;
  ask: number;
  mid: number;
  lastPrice: number;
}
