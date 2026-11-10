import type { Bars, Market } from "../engine/types";
import { indicators, type Ind } from "../engine/indicators";
import { rateUniverse } from "../engine/rs";
import { benchPath, loadAllBars, readJson } from "./store";

export interface Loaded {
  market: Market;
  all: Bars[];
  bench: Bars | null;
  ind: (b: Bars) => Ind;
}

/** Load every symbol for a market and rate relative strength across them. */
export function loadMarket(market: Market): Loaded {
  const all = loadAllBars(market);
  const bench = readJson<Bars>(benchPath(market));
  rateUniverse(all);
  // Not cached: a full market of indicator arrays would not fit comfortably in memory.
  const ind = (b: Bars) => indicators(b, bench ?? undefined);
  return { market, all, bench, ind };
}

/** "2024-03-15" or "20240315" -> 20240315 */
export const parseDate = (s: string) => Number(s.replaceAll("-", ""));

/** Index of the last bar on or before `date`, or -1. */
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
