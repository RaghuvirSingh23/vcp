/**
 * Scan a market as of its latest bar (or --asof YYYY-MM-DD) and write data/scan/<market>.json.
 * Also stores each stock's RS rating history on its bars file so the chart can replay any date.
 *
 *   npm run scan -- --market us
 *   npm run scan -- --market in --asof 2024-06-28
 */
import type { Market } from "../engine/types";
import { analyze } from "../engine/vcp";
import { DATA, args, barsPath, fileKey, loadUniverse, markets, writeJson } from "./store";
import { indexAt, loadMarket, parseDate } from "./prep";
import { join } from "node:path";

export interface ScanRow {
  symbol: string;
  file: string;
  name: string;
  sector?: string;
  date: number;
  close: number;
  chg: number;
  /** Median daily traded value over 50 bars, in the market's currency. */
  value: number;
  rs: number;
  valid: boolean;
  grade: "A" | "B" | null;
  weaknesses: string[];
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

function run(market: Market, a: Record<string, string>) {
  const t0 = Date.now();
  const M = loadMarket(market);
  if (!M.all.length) throw new Error(`No bars for ${market}. Run: npm run fetch -- --market ${market}`);
  const uni = new Map(loadUniverse(market).map((e) => [e.symbol, e]));
  // The market's last session is the latest date most symbols share; a stale file must not look current.
  const lastDates = M.all.map((b) => b.d[b.d.length - 1]).sort((x, y) => x - y);
  const marketDate = a.asof ? parseDate(a.asof) : lastDates[Math.floor(lastDates.length * 0.5)];

  const rows: ScanRow[] = [];
  let stale = 0;
  for (const b of M.all) {
    const t = indexAt(b, marketDate);
    if (t < 0) continue;
    // Halted, delisted or not refreshed: more than 5 sessions behind the market.
    if (daysBetween(b.d[t], marketDate) > 7) {
      stale++;
      continue;
    }
    const I = M.ind(b);
    const r = analyze(b, I, t);
    const vals: number[] = [];
    for (let i = Math.max(0, t - 49); i <= t; i++) vals.push(b.c[i] * b.v[i]);
    vals.sort((x, y) => x - y);
    const row: ScanRow = {
      symbol: b.symbol,
      file: fileKey(b.symbol),
      name: b.name,
      sector: uni.get(b.symbol)?.sector,
      date: b.d[t],
      close: b.c[t],
      chg: t > 0 ? b.c[t] / b.c[t - 1] - 1 : 0,
      value: vals[Math.floor(vals.length / 2)],
      rs: I.rs[t] || 0,
      valid: !!r?.valid,
      grade: r?.grade ?? null,
      weaknesses: r?.weaknesses ?? [],
      state: r?.state ?? "none",
      kind: r?.kind ?? "",
      score: r?.score ?? 0,
      footprint: r?.footprint ?? "",
      depths: r ? r.contractions.map((c) => Math.round(c.depth * 1000) / 1000) : [],
      pivot: r?.pivot ?? 0,
      stop: r?.stop ?? 0,
      dist: r?.distPct ?? 0,
      risk: r?.riskPct ?? 0,
      dryUp: r?.metrics.dryUp ?? 0,
      failed: r ? r.failed : ["none"],
      breakout: r?.breakout && { date: r.breakout.date, barsAgo: r.breakout.barsAgo, vol: r.breakout.volRatio },
    };
    rows.push(row);
  }
  rows.sort((x, y) => Number(y.valid) - Number(x.valid) || (x.grade ?? "Z").localeCompare(y.grade ?? "Z") || y.score - x.score);
  writeJson(join(DATA, "scan", market + ".json"), {
    market,
    date: marketDate,
    generatedAt: new Date().toISOString(),
    universe: M.all.length,
    stale,
    benchmark: M.bench?.symbol ?? null,
    rows,
  });
  if (!a.asof) for (const b of M.all) writeJson(barsPath(market, b.symbol), b);
  const valid = rows.filter((r) => r.valid);
  console.log(
    `${market} ${marketDate}: ${rows.length} read, ${valid.length} valid (${valid.filter((r) => r.grade === "A").length} grade A) ` +
      `(${valid.filter((r) => r.state === "ready").length} at pivot, ${valid.filter((r) => r.state === "breakout").length} breaking out, ` +
      `${valid.filter((r) => r.state === "forming").length} forming, ${valid.filter((r) => r.state === "extended").length} extended), ` +
      `${stale} stale, ${Math.round((Date.now() - t0) / 100) / 10}s`,
  );
  for (const r of valid.slice(0, 15))
    console.log(`  ${r.grade} ${r.symbol.padEnd(12)} ${r.state.padEnd(9)} ${r.footprint.padEnd(14)} score ${String(r.score).padStart(3)}  RS ${String(r.rs).padStart(2)}  pivot ${r.pivot}  ${(r.dist * 100).toFixed(1)}% away`);
}

function daysBetween(a: number, b: number): number {
  const f = (x: number) => Date.UTC(Math.floor(x / 10000), (Math.floor(x / 100) % 100) - 1, x % 100);
  return Math.round((f(b) - f(a)) / 86400e3);
}

const a = args();
for (const m of markets(a)) run(m, a);
