export type Market = "us" | "in";

/** Daily bars, columnar. Prices are split-adjusted (not dividend-adjusted), oldest first. */
export interface Bars {
  symbol: string;
  market: Market;
  name: string;
  currency: string;
  exchange?: string;
  /** Trading dates as YYYYMMDD integers, exchange-local. */
  d: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
  v: number[];
  /** Relative-strength rating 1..99 per bar (0 = not available). Written by the scan step. */
  rs?: number[];
  fetchedAt?: string;
  warnings?: string[];
}

export interface UniverseEntry {
  symbol: string;
  /** Symbol as the data vendor spells it. */
  yahoo: string;
  name: string;
  sector?: string;
}
