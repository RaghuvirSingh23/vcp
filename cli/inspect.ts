/** Print the detector's full reading of one chart on one date. npm run inspect -- --market us --symbol AXON --date 2004-01-15 */
import type { Market } from "../engine/types";
import { analyze } from "../engine/vcp";
import { args } from "./store";
import { indexAt, loadMarket, parseDate } from "./prep";

const a = args();
const M = loadMarket((a.market ?? "us") as Market);
const b = M.all.find((x) => x.symbol === (a.symbol ?? "").toUpperCase());
if (!b) throw new Error(`no bars for ${a.symbol}`);
const t = a.date ? indexAt(b, parseDate(a.date)) : b.d.length - 1;
const r = analyze(b, M.ind(b), t);
if (!r) {
  console.log(`${b.symbol} ${b.d[t]}: no base to read`);
} else {
  const D = (i: number) => b.d[i];
  console.log(`${b.symbol} ${r.date} close ${r.close}  ${r.valid ? "VALID" : "not valid"}  ${r.state}  ${r.kind}  score ${r.score}  ${r.footprint}`);
  console.log(`  base ${D(r.base.start)} high ${r.base.high} -> low ${D(r.base.lowIdx)} ${r.base.low}  prior low ${r.base.priorLowIdx >= 0 ? D(r.base.priorLowIdx) : "-"} ${r.base.priorLow} (+${(r.base.priorAdvance * 100).toFixed(0)}%)`);
  for (const c of r.contractions)
    console.log(`  T${c.n} ${D(c.hi)} ${c.high} -> ${D(c.lo)} ${c.low}  -${(c.depth * 100).toFixed(1)}%  ${c.downBars}d down, ends ${D(c.end)}  vol ${c.volRatio.toFixed(2)}x${c.shakeout ? `  shakeout: low ${D(c.shakeout.lowIdx)} ${c.shakeout.low}, rebound ${D(c.shakeout.reboundIdx)} ${c.shakeout.rebound}` : ""}`);
  console.log(`  pivot ${r.pivot} (${D(r.pivotIdx)})  stop ${r.stop}  risk ${(r.riskPct * 100).toFixed(1)}%  dist ${(r.distPct * 100).toFixed(1)}%${r.breakout ? `  BREAKOUT ${r.breakout.date} vol ${r.breakout.volRatio.toFixed(2)}x` : ""}`);
  for (const c of r.checks) console.log(`  ${c.pass === null ? "·" : c.pass ? "✓" : "✗"} ${c.required ? "R" : "q"} ${c.label.padEnd(42)} ${c.value.padEnd(28)} want ${c.want}`);
}
