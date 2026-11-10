import type { Bars, Market } from "../engine/types";

export interface ScanRow {
  symbol: string;
  file: string;
  name: string;
  sector?: string;
  date: number;
  close: number;
  chg: number;
  value: number;
  rs: number;
  valid: boolean;
  state: string;
  kind: string;
  score: number;
  footprint: string;
  depths: number[];
  pivot: number;
  stop: number;
  dist: number;
  risk: number;
  dryUp: number;
  failed: string[];
  breakout?: { date: number; barsAgo: number; vol: number };
}

export interface ScanFile {
  market: Market;
  date: number;
  generatedAt: string;
  universe: number;
  stale: number;
  benchmark: string | null;
  rows: ScanRow[];
}

const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T | null> {
  let p = cache.get(path) as Promise<T | null> | undefined;
  if (!p) {
    p = fetch(path).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
    cache.set(path, p);
  }
  return p;
}

export const getScan = (m: Market) => get<ScanFile>(`/data/scan/${m}.json`);
export const getBars = (m: Market, file: string) => get<Bars>(`/data/bars/${m}/${encodeURIComponent(file)}.json`);
export const getBench = (m: Market) => get<Bars>(`/data/bars/${m}/_benchmark.json`);
export const fileKey = (symbol: string) => symbol.replace(/[^A-Za-z0-9._-]/g, "_");

export const BENCH_NAME: Record<string, string> = { "^GSPC": "S&P 500", "^CRSLDX": "Nifty 500", "^NSEI": "Nifty 50" };
export const MARKET_LABEL: Record<Market, string> = { us: "US", in: "India" };

/** Index of the last bar on or before `date`. */
export function indexAt(b: Bars, date: number): number {
  let lo = 0;
  let hi = b.d.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (b.d[m] <= date) (ans = m), (lo = m + 1);
    else hi = m - 1;
  }
  return ans;
}

export const isoDate = (d: number) =>
  `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`;
