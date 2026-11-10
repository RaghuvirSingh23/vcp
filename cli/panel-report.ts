/**
 * Compare a blind panel's verdicts with the detector.
 *
 *   npm run panel-report -- --round 1
 *
 * Reads data/panel/keys/round<N>.json (what each chart is) and
 * data/panel/keys/round<N>.reviews.json (the reviewers' answers).
 */
import { join } from "node:path";
import type { Bars, Market } from "../engine/types";
import { indicators, median } from "../engine/indicators";
import { analyze } from "../engine/vcp";
import { DATA, args, benchPath, loadBars, readJson, writeJson } from "./store";
import { indexAt } from "./prep";

interface KeyItem {
  id: string;
  market: Market;
  symbol: string;
  date: number;
  kind: string;
}
interface Review {
  lens: string;
  id: string;
  verdict: "yes" | "borderline" | "no";
  confidence: number;
  contractions: number[];
  pivot?: number | null;
  tags: string[];
  reason: string;
}

const a = args();
const round = a.round ?? "1";
const key = readJson<KeyItem[]>(join(DATA, "panel", "keys", `round${round}.json`)) ?? [];
const reviews = (readJson<{ reviews: Review[] }>(join(DATA, "panel", "keys", `round${round}.reviews.json`)) ?? { reviews: [] }).reviews;
const by = new Map<string, Review[]>();
for (const r of reviews) by.set(r.id, [...(by.get(r.id) ?? []), r]);
const benches = new Map<Market, Bars | null>();

const rows = key.map((k) => {
  const b = loadBars(k.market, k.symbol)!;
  if (!benches.has(k.market)) benches.set(k.market, readJson<Bars>(benchPath(k.market)));
  const t = indexAt(b, k.date);
  const I = indicators(b, benches.get(k.market) ?? undefined);
  const r = analyze(b, I, t);
  const rv = by.get(k.id) ?? [];
  const score = rv.length ? rv.reduce((s, x) => s + (x.verdict === "yes" ? 1 : x.verdict === "borderline" ? 0.5 : 0), 0) / rv.length : NaN;
  // Candidate measurements of what the eye calls tight.
  let f: Record<string, number> = {};
  if (r) {
    const last = r.contractions[r.contractions.length - 1];
    const cl = (n: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = Math.max(0, t - n + 1); i <= t; i++) {
        lo = Math.min(lo, b.c[i]);
        hi = Math.max(hi, b.c[i]);
      }
      return (hi - lo) / hi;
    };
    const baseTr = median(I.tr, r.base.start + 1, Math.max(r.base.start + 1, last.hi));
    const pb = last.hi;
    f = {
      depthK: last.depth,
      bars: r.metrics.finalBars,
      downBars: last.downBars,
      range: r.metrics.rangeContraction,
      dry: r.metrics.dryUp,
      close4: cl(4),
      close5: cl(5),
      baseTr,
      depthInTr: last.depth / baseTr,
      // Share of the pivot bar's range that is upper wick: a spike high makes a poor pivot.
      wick: (b.h[pb] - Math.max(b.o[pb], b.c[pb])) / Math.max(1e-9, b.h[pb] - b.l[pb]),
      lowAge: t - last.lo,
      pos: r.metrics.pivotPos,
      // Where the close sits inside the final contraction (1 = at the pivot).
      closePos: (b.c[t] - last.low) / Math.max(1e-9, last.high - last.low),
      K: r.contractions.length,
      // The last three sessions against the base: bar ranges and close-to-close moves.
      tr3: median(I.tr, t - 2, t) / baseTr,
      dc3: (Math.abs(b.c[t] / b.c[t - 1] - 1) + Math.abs(b.c[t - 1] / b.c[t - 2] - 1) + Math.abs(b.c[t - 2] / b.c[t - 3] - 1)) / 3 / baseTr,
      ...distribution(b, I.vol50, r.base.start, t),
    };
  }
  return { ...k, valid: !!r?.valid, failed: r?.failed ?? ["none"], footprint: r?.footprint ?? "", state: r?.state ?? "", score, votes: rv.map((x) => x.verdict[0]).join(""), rv, f };
});

/** Heaviest down day and heaviest up day inside the base, as multiples of average volume. */
function distribution(b: Bars, vol50: Float64Array, from: number, to: number) {
  let down = 0;
  let up = 0;
  for (let i = Math.max(1, from); i <= to; i++) {
    const x = b.v[i] / vol50[i];
    if (!(x === x)) continue;
    if (b.c[i] < b.c[i - 1]) down = Math.max(down, x);
    else up = Math.max(up, x);
  }
  return { maxDown: down, maxUp: up };
}

const cls = (s: number) => (s >= 0.67 ? "YES" : s >= 0.34 ? "mid" : "no");
console.log(`round ${round}: ${rows.length} charts, ${reviews.length} reviews\n`);
console.log("Panel verdict by what the chart is (rows) — YES / mid / no:");
for (const kind of ["ref", "valid", "near", "control", "down"]) {
  const list = rows.filter((r) => r.kind === kind);
  const c = (v: string) => list.filter((r) => cls(r.score) === v).length;
  console.log(`  ${kind.padEnd(8)} n ${String(list.length).padStart(2)}   YES ${String(c("YES")).padStart(2)}   mid ${String(c("mid")).padStart(2)}   no ${String(c("no")).padStart(2)}`);
}
console.log("\nPanel verdict against the detector as it stands now:");
for (const v of [true, false]) {
  const list = rows.filter((r) => r.valid === v);
  const c = (x: string) => list.filter((r) => cls(r.score) === x).length;
  console.log(`  detector ${v ? "valid  " : "invalid"} n ${String(list.length).padStart(2)}   YES ${String(c("YES")).padStart(2)}   mid ${String(c("mid")).padStart(2)}   no ${String(c("no")).padStart(2)}`);
}
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "  - ");
console.log("\nEvery chart (panel score = mean of yes 1, borderline 0.5, no 0):");
for (const r of [...rows].sort((x, y) => Number(y.valid) - Number(x.valid) || y.score - x.score)) {
  console.log(
    `${r.id} ${r.kind.padEnd(7)} ${r.valid ? "VALID" : "     "} panel ${num(r.score)} ${r.votes.padEnd(3)} ${r.market}/${r.symbol.padEnd(11)} ${String(r.date)} ${r.footprint.padEnd(14)} ` +
      `bars ${String(r.f.bars ?? "-").padStart(3)} dn ${String(r.f.downBars ?? "-").padStart(2)} rng ${num(r.f.range)} c4 ${num(r.f.close4 * 100, 1)} wick ${num(r.f.wick)} cpos ${num(r.f.closePos)} pos ${num(r.f.pos)} tr3 ${num(r.f.tr3)} dc3 ${num(r.f.dc3)} dry ${num(r.f.dry)} dK ${num(r.f.depthK * 100, 1)}  ${r.failed.join(",")}`,
  );
}
if (a.reasons) {
  console.log("\nReasons where panel and detector disagree:");
  for (const r of rows) {
    const disagree = (r.valid && r.score < 0.67) || (!r.valid && r.score >= 0.5);
    if (!disagree) continue;
    console.log(`\n${r.id} ${r.market}/${r.symbol} ${r.date} ${r.kind} detector ${r.valid ? "VALID" : "invalid: " + r.failed.join(",")} ${r.footprint}`);
    for (const x of r.rv) console.log(`   ${x.lens.padEnd(8)} ${x.verdict.padEnd(10)} [${x.contractions.join("/")}] piv ${x.pivot ?? "-"} {${x.tags.join(",")}} ${x.reason}`);
  }
}
writeJson(join(DATA, "panel", "keys", `round${round}.table.json`), rows.map(({ rv, ...rest }) => rest));
