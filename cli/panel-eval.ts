/**
 * Score rule variants against every blind-panel verdict on file.
 *
 *   npm run panel-eval -- --rounds 1,2
 *
 * A chart counts as accepted by the panel at a mean score of 0.5 or more (yes = 1,
 * borderline = 0.5, no = 0), which is where the readers put Minervini's own
 * MercadoLibre example. "Clear" means 0.83 or more, or 0.17 or less.
 */
import { join } from "node:path";
import type { Bars, Market } from "../engine/types";
import { indicators, type Ind } from "../engine/indicators";
import { analyze } from "../engine/vcp";
import { DEFAULTS, type Params } from "../engine/config";
import { DATA, args, benchPath, loadBars, readJson } from "./store";
import { indexAt } from "./prep";

interface Item {
  id: string;
  market: Market;
  symbol: string;
  date: number;
  kind: string;
  score: number;
  b: Bars;
  I: Ind;
  t: number;
}

const a = args();
const rounds = (a.rounds ?? "1,2").split(",");
const items: Item[] = [];
const benches = new Map<Market, Bars | null>();
for (const r of rounds) {
  const key = readJson<any[]>(join(DATA, "panel", "keys", `round${r}.json`)) ?? [];
  const rev = readJson<{ reviews: any[] }>(join(DATA, "panel", "keys", `round${r}.reviews.json`))?.reviews ?? [];
  for (const k of key) {
    const rv = rev.filter((x) => x.id === k.id);
    if (rv.length < Number(a.min ?? 2)) continue;
    const score = rv.reduce((s, x) => s + (x.verdict === "yes" ? 1 : x.verdict === "borderline" ? 0.5 : 0), 0) / rv.length;
    if (!benches.has(k.market)) benches.set(k.market, readJson<Bars>(benchPath(k.market)));
    const b = loadBars(k.market, k.symbol)!;
    items.push({ id: `r${r}${k.id}`, market: k.market, symbol: k.symbol, date: k.date, kind: k.kind, score, b, I: indicators(b, benches.get(k.market) ?? undefined), t: indexAt(b, k.date) });
  }
}
console.log(`${items.length} charts with enough reviews (rounds ${rounds.join(", ")})`);
const yes = items.filter((x) => x.score >= 0.83).length;
const no = items.filter((x) => x.score <= 0.17).length;
console.log(`panel: ${yes} clear yes, ${items.filter((x) => x.score >= 0.5).length} accepted, ${no} clear no\n`);

// Each line is the configured rule set with one thing changed, to show what that rule is worth.
const VARIANTS: [string, Partial<Params>][] = [
  ["as configured", {}],
  ["no resistance rule", { resistance: false }],
  ["no retest rule", { nestedRetest: false }],
  ["pivot anywhere in upper half", { pivotGapShare: 0.5 }],
  ["no minimum base depth", { minBaseDepth: 0 }],
  ["no reach limit", { maxPivotDistance: Infinity }],
  ["no recent-range limit", { maxRecentRange: Infinity }],
  ["step ratio 0.75", { maxStepRatio: 0.75 }],
  ["noise multiple 1.25", { noiseMult: 1.25 }],
  ["overall ratio 0.5", { maxOverallRatio: 0.5 }],
  ["pivot age 5 sessions", { minFinalBars: 5 }],
  ["dry-up under 0.9", { dryUpMax: 0.9 }],
];
if (a.combo) {
  // --combo "pivotGapShare=0.35,pivotGapMin=0,nestedRetest=true"
  const o: Record<string, unknown> = {};
  for (const kv of a.combo.split(",")) {
    const [k, v] = kv.split("=");
    o[k] = v === "true" ? true : v === "false" ? false : Number(v);
  }
  VARIANTS.push(["combo", o as Partial<Params>]);
}

console.log("variant".padEnd(26), "valid", " acc", " rej", "| clearYes→valid", "| clearNo→valid", "| agree%");
for (const [name, over] of VARIANTS) {
  const P = { ...DEFAULTS, ...over };
  let valid = 0;
  let acc = 0;
  let rej = 0;
  let cyv = 0;
  let cnv = 0;
  let agree = 0;
  const fp: string[] = [];
  const fn: string[] = [];
  for (const it of items) {
    const r = analyze(it.b, it.I, it.t, P);
    const v = !!r?.valid;
    if (v) {
      valid++;
      if (it.score >= 0.5) acc++;
      else {
        rej++;
        fp.push(`${it.id}:${it.symbol}(${it.score.toFixed(2)})`);
      }
    } else if (it.score >= 0.67) fn.push(`${it.id}:${it.symbol}(${it.score.toFixed(2)})${r ? ":" + r.failed.join("+") : ""}`);
    if (it.score >= 0.83 && v) cyv++;
    if (it.score <= 0.17 && v) cnv++;
    if (v === it.score >= 0.5) agree++;
  }
  console.log(
    name.padEnd(26),
    String(valid).padStart(5),
    String(acc).padStart(4),
    String(rej).padStart(4),
    "|",
    `${cyv}/${yes}`.padStart(14),
    "|",
    `${cnv}/${no}`.padStart(12),
    "|",
    ((agree / items.length) * 100).toFixed(1).padStart(6),
  );
  if (a.detail === name || (a.detail === "all" && name !== "")) {
    console.log("   rejected by panel but valid:", fp.join(" "));
    console.log("   accepted (≥0.67) but invalid:", fn.join(" "));
  }
}
