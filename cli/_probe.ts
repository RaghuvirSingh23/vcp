// scratch: distribution of pivot-window stats over currently valid setups
import { analyze } from "../engine/vcp";
import { median } from "../engine/indicators";
import { loadMarket } from "./prep";
for (const m of ["us", "in"] as const) {
  const M = loadMarket(m);
  const rows: string[] = [];
  for (const b of M.all) {
    const t = b.d.length - 1;
    const I = M.ind(b);
    const r = analyze(b, I, t);
    if (!r || !r.valid) continue;
    const last = r.contractions[r.contractions.length - 1];
    const end = r.breakout ? r.breakout.idx - 1 : t;
    const mt = median(I.tr, last.hi + 1, end);
    const steps = r.contractions.slice(1).map((c, i) => (c.depth / r.contractions[i].depth).toFixed(2)).join(",");
    rows.push(`${b.symbol.padEnd(11)} ${r.footprint.padEnd(13)} bars ${String(r.metrics.finalBars).padStart(3)}  medTR ${(mt * 100).toFixed(2)}%  rangeRatio ${r.metrics.rangeContraction.toFixed(2)}  dry ${r.metrics.dryUp.toFixed(2)}  steps ${steps}  ${r.state}`);
  }
  console.log(m, rows.length);
  console.log(rows.join("\n"));
}
