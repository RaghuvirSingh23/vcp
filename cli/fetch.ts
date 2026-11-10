/**
 * Download daily bars for the universe.
 *
 *   npm run fetch -- --market us
 *   npm run fetch -- --market in --since 2010-01-01
 *   npm run fetch -- --market us --symbols NVDA,AXON --since 2000-01-01
 *
 * Every run refetches the full history for each symbol: a split or bonus issue
 * re-bases all earlier prices, so appending to an old file would corrupt it.
 */
import { existsSync, statSync } from "node:fs";
import type { Market, UniverseEntry } from "../engine/types";
import { MARKETS, args, barsPath, benchPath, loadUniverse, markets, pool, writeJson } from "./store";
import { NotFound, fetchBars } from "./yahoo";

async function run(market: Market, a: Record<string, string>) {
  const since = a.since ?? "2010-01-01";
  let list: UniverseEntry[] = loadUniverse(market);
  if (a.symbols) {
    const want = a.symbols.split(",").map((s) => s.trim().toUpperCase());
    const known = new Map(list.map((e) => [e.symbol, e]));
    list = want.map(
      (s) => known.get(s) ?? { symbol: s, yahoo: market === "in" ? s + ".NS" : s.replace(".", "-"), name: "" },
    );
  }
  if (!list.length) throw new Error(`No universe for ${market}. Run: npm run universe -- --market ${market}`);

  // Benchmark first: the RS line and the market-regime column both need it.
  for (const sym of MARKETS[market].benchmark) {
    try {
      const b = await fetchBars(sym, sym, market, sym, { since: "1995-01-01", keepUntraded: true });
      if (b.d.length > 500) {
        writeJson(benchPath(market), b);
        console.log(`${market}: benchmark ${sym}, ${b.d.length} bars to ${b.d[b.d.length - 1]}`);
        break;
      }
    } catch (e) {
      console.log(`${market}: benchmark ${sym} unavailable (${(e as Error).message})`);
    }
  }

  // --fresh N skips files written in the last N hours, so an interrupted run can resume.
  const freshMs = Number(a.fresh ?? 0) * 3600e3;
  let ok = 0;
  let skipped = 0;
  const failed: string[] = [];
  const missing: string[] = [];
  const t0 = Date.now();
  await pool(list, Number(a.concurrency ?? 6), async (e, i) => {
    const path = barsPath(market, e.symbol);
    if (freshMs && existsSync(path) && Date.now() - statSync(path).mtimeMs < freshMs) {
      skipped++;
      return;
    }
    try {
      const b = await fetchBars(e.yahoo, e.symbol, market, e.name, { since });
      if (b.d.length < 30) {
        missing.push(e.symbol);
        return;
      }
      writeJson(path, b);
      ok++;
    } catch (err) {
      if (err instanceof NotFound) missing.push(e.symbol);
      else failed.push(`${e.symbol}: ${(err as Error).message}`);
    }
    if ((i + 1) % 250 === 0) console.log(`  ${market}: ${i + 1}/${list.length} (${Math.round((Date.now() - t0) / 1000)}s)`);
  });
  console.log(
    `${market}: ${ok} written, ${skipped} fresh, ${missing.length} without data, ${failed.length} failed in ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  if (missing.length) console.log(`  no data: ${missing.slice(0, 40).join(" ")}${missing.length > 40 ? " …" : ""}`);
  if (failed.length) console.log(`  failed:\n    ${failed.slice(0, 20).join("\n    ")}`);
}

const a = args();
for (const m of markets(a)) await run(m, a);
