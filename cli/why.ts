/** Day-by-day trace of what the detector reads and which required checks fail. npm run why -- --market us --symbol PLTR --from 2024-08-15 --to 2024-09-10 */
import type { Market } from "../engine/types";
import { analyze } from "../engine/vcp";
import { args } from "./store";
import { indexAt, loadMarket, parseDate } from "./prep";

const a = args();
const M = loadMarket((a.market ?? "us") as Market);
const b = M.all.find((x) => x.symbol === (a.symbol ?? "").toUpperCase());
if (!b) throw new Error(`no bars for ${a.symbol}`);
const I = M.ind(b);
const t0 = Math.max(41, indexAt(b, parseDate(a.from ?? "2000-01-01")));
const t1 = indexAt(b, parseDate(a.to ?? "2099-01-01"));
for (let t = t0; t <= t1; t++) {
  const r = analyze(b, I, t);
  if (!r) {
    console.log(`${b.d[t]} ${b.c[t].toFixed(2).padStart(9)}  no base`);
    continue;
  }
  const deps = r.contractions.map((c) => (c.depth * 100).toFixed(0)).join("/");
  console.log(
    `${b.d[t]} ${b.c[t].toFixed(2).padStart(9)}  ${r.valid ? "VALID" : "     "} ${r.state.padEnd(8)} ${r.footprint.padEnd(14)} [${deps}] piv ${r.pivot.toFixed(2)} bars ${r.metrics.finalBars} rng ${r.metrics.rangeContraction.toFixed(2)} dry ${r.metrics.dryUp.toFixed(2)} rs ${Math.round(r.metrics.rs)}  ${r.failed.join(",")}`,
  );
}
