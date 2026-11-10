/** Reader acceptance by the detector's grade, per round and for alternative grade thresholds. npm run panel-grade -- --rounds 1,2,3 */
import { join } from "node:path";
import type { Bars, Market } from "../engine/types";
import { indicators, type Ind } from "../engine/indicators";
import { analyze } from "../engine/vcp";
import { DEFAULTS, type Params } from "../engine/config";
import { DATA, args, benchPath, loadBars, readJson } from "./store";
import { indexAt } from "./prep";

const a = args();
const rounds = (a.rounds ?? "1,2,3").split(",");
const benches = new Map<Market, Bars | null>();
const items: { round: string; id: string; symbol: string; panel: number; b: Bars; I: Ind; t: number }[] = [];
for (const r of rounds) {
  const key = readJson<any[]>(join(DATA, "panel", "keys", `round${r}.json`)) ?? [];
  const rev = readJson<{ reviews: any[] }>(join(DATA, "panel", "keys", `round${r}.reviews.json`))?.reviews ?? [];
  for (const k of key) {
    const rv = rev.filter((x) => x.id === k.id);
    if (rv.length < 3) continue;
    if (!benches.has(k.market)) benches.set(k.market, readJson<Bars>(benchPath(k.market)));
    const b = loadBars(k.market, k.symbol)!;
    items.push({ round: r, id: k.id, symbol: k.symbol, panel: rv.reduce((s, x) => s + (x.verdict === "yes" ? 1 : x.verdict === "borderline" ? 0.5 : 0), 0) / 3, b, I: indicators(b, benches.get(k.market) ?? undefined), t: indexAt(b, k.date) });
  }
}
const line = (name: string, g: typeof items) => {
  const acc = g.filter((x) => x.panel >= 0.5).length;
  const yes = g.filter((x) => x.panel >= 0.83).length;
  const no = g.filter((x) => x.panel <= 0.17).length;
  console.log(`  ${name.padEnd(30)} n ${String(g.length).padStart(3)}   accepted ${String(acc).padStart(3)} (${g.length ? ((acc / g.length) * 100).toFixed(0) : "-"}%)   clear yes ${String(yes).padStart(2)}   clear no ${String(no).padStart(2)}${g.length - acc ? "   rejected: " + g.filter((x) => x.panel < 0.5).map((x) => `r${x.round}${x.id}:${x.symbol}(${x.panel.toFixed(2)})`).join(" ") : ""}`);
};
const run = (name: string, over: Partial<Params>) => {
  const P = { ...DEFAULTS, ...over };
  const graded = items.map((it) => ({ it, r: analyze(it.b, it.I, it.t, P) }));
  console.log(name);
  line("grade A", graded.filter((x) => x.r?.grade === "A").map((x) => x.it));
  line("grade B", graded.filter((x) => x.r?.grade === "B").map((x) => x.it));
  line("not valid", graded.filter((x) => !x.r?.valid).map((x) => x.it));
  if (a.perRound) for (const rd of rounds) line(`  round ${rd} grade A`, graded.filter((x) => x.it.round === rd && x.r?.grade === "A").map((x) => x.it));
};
console.log(`${items.length} charts judged by all three readers (rounds ${rounds.join(", ")})\n`);
run("as configured", {});
if (a.sweep) {
  run("final ≤ 8.5%", { gradeFinalDepth: 0.085 });
  run("final ≤ 10%", { gradeFinalDepth: 0.1 });
  run("two contractions allowed", { gradeCount: 2 });
  run("trend ≥ 5%", { gradeTrend: 0.05 });
  run("trend ≥ 12%", { gradeTrend: 0.12 });
  run("dry-up ≤ 1.0", { gradeDryUp: 1.0 });
  run("depth ≤ 50%", { idealBaseDepth: 0.5 });
}
