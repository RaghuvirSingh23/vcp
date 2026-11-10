/**
 * Write the small price excerpts the tests run on: ~900 sessions up to a few days
 * past each reference date, with the RS ratings as they stood in the full universe.
 *
 *   npm run fixtures
 */
import { join } from "node:path";
import type { Bars, Market } from "../engine/types";
import { ROOT, loadBars, writeJson } from "./store";
import { indexAt } from "./prep";

const CASES: [Market, string, number][] = [
  ["us", "MELI", 20071207],
  ["us", "NFLX", 20091013],
  ["us", "AXON", 20040108],
  ["us", "LULU", 20101104],
  ["us", "NVDA", 20240105],
  ["in", "WOCKPHARMA", 20261109],
  ["us", "BWIN", 20261109],
  ["us", "DHT", 20260730],
  ["us", "OZK", 20140616],
];

for (const [market, symbol, date] of CASES) {
  const b = loadBars(market, symbol);
  if (!b || !b.rs) throw new Error(`need scanned bars for ${symbol}`);
  const t = indexAt(b, date);
  const a = Math.max(0, t - 900);
  const z = Math.min(b.d.length, t + 6);
  const cut = <T,>(x: T[]) => x.slice(a, z);
  const out: Bars = { symbol, market, name: b.name, currency: b.currency, d: cut(b.d), o: cut(b.o), h: cut(b.h), l: cut(b.l), c: cut(b.c), v: cut(b.v), rs: cut(b.rs) };
  writeJson(join(ROOT, "tests", "fixtures", `${symbol}-${date}.json`), out);
  console.log(`${symbol} ${date}: ${out.d.length} bars`);
}
