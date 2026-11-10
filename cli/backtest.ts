/**
 * Replay the detector over history and record every pivot breakout with what followed.
 *
 *   npm run backtest -- --market us
 *   npm run backtest -- --market in --from 2015-01-01
 *
 * Writes data/backtest/<market>.json. The universe is today's listings, so stocks
 * that have since been delisted are missing: results are survivorship-biased.
 */
import { join } from "node:path";
import type { Market } from "../engine/types";
import { DEFAULTS } from "../engine/config";
import { benchRef, signalsFor, summarize, type Signal } from "../engine/backtest";
import { DATA, args, markets, writeJson } from "./store";
import { loadMarket, parseDate } from "./prep";

const pct = (x: number) => (x * 100).toFixed(1) + "%";

function run(market: Market, a: Record<string, string>) {
  const t0 = Date.now();
  const M = loadMarket(market);
  if (!M.all.length) throw new Error(`No bars for ${market}. Run: npm run fetch -- --market ${market}`);
  const bench = benchRef(M.bench);
  const from = a.from ? parseDate(a.from) : 20000101;
  let list = M.all;
  if (a.symbols) {
    const want = new Set(a.symbols.split(",").map((s) => s.trim().toUpperCase()));
    list = list.filter((b) => want.has(b.symbol));
  }
  if (a.limit) list = list.slice(0, Number(a.limit));

  const signals: Signal[] = [];
  let bars = 0;
  list.forEach((b, k) => {
    signals.push(...signalsFor(b, M.ind(b), bench, DEFAULTS, { from }));
    bars += b.c.length;
    if ((k + 1) % 500 === 0) console.log(`  ${market}: ${k + 1}/${list.length} symbols, ${signals.length} signals, ${Math.round((Date.now() - t0) / 1000)}s`);
  });
  signals.sort((x, y) => x.date - y.date || x.symbol.localeCompare(y.symbol));
  const lastDate = Math.max(...list.map((b) => b.d[b.d.length - 1]));
  writeJson(join(DATA, "backtest", market + ".json"), {
    market,
    generatedAt: new Date().toISOString(),
    from,
    to: lastDate,
    symbols: list.length,
    bars,
    benchmark: M.bench?.symbol ?? null,
    params: DEFAULTS,
    signals,
  });

  const taken = signals.filter((s) => !s.chase);
  const S = summarize(taken);
  console.log(
    `${market}: ${signals.length} breakouts (${signals.length - taken.length} gapped past the buy zone) from ${list.length} symbols, ` +
      `${(bars / 1e6).toFixed(1)}M bars, ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  console.log(
    `  reference trade: n ${S.n}  win ${pct(S.winRate)}  avg ${S.avgR.toFixed(2)}R  median ${S.medianR.toFixed(2)}R  ` +
      `avg win ${S.avgWinR.toFixed(2)}R  avg loss ${S.avgLossR.toFixed(2)}R  PF ${S.profitFactor.toFixed(2)}  hold ${S.avgHold.toFixed(0)}d  risk ${pct(S.avgRisk)}`,
  );
  for (const h of S.horizons)
    console.log(`  +${String(h.bars).padStart(2)}d: mean ${pct(h.mean)}  median ${pct(h.median)}  positive ${pct(h.positive)}  vs benchmark ${pct(h.excess)}  (n ${h.n})`);
  for (const grade of ["A", "B"] as const) {
    const g = summarize(taken.filter((s) => s.grade === grade));
    const h = g.horizons[3];
    console.log(
      `  grade ${grade}: n ${g.n}  win ${pct(g.winRate)}  avg ${g.avgR.toFixed(2)}R  PF ${g.profitFactor.toFixed(2)}  +60d mean ${pct(h.mean)} vs benchmark ${pct(h.excess)}`,
    );
  }
  const byYear = new Map<number, Signal[]>();
  for (const s of taken) {
    const y = Math.floor(s.date / 10000);
    byYear.set(y, [...(byYear.get(y) ?? []), s]);
  }
  for (const [y, list] of [...byYear].sort((p, q) => p[0] - q[0])) {
    const s = summarize(list);
    console.log(`  ${y}: ${String(list.length).padStart(5)} signals  win ${pct(s.winRate).padStart(6)}  avg ${s.avgR.toFixed(2).padStart(6)}R`);
  }
}

const a = args();
for (const m of markets(a)) run(m, a);
