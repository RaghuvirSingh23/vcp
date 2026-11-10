/** How often the blind readers agree with each other, and how the detector compares. npm run panel-agreement -- --rounds 1,2,3 */
import { join } from "node:path";
import type { Bars, Market } from "../engine/types";
import { indicators } from "../engine/indicators";
import { analyze } from "../engine/vcp";
import { DATA, args, benchPath, loadBars, readJson } from "./store";
import { indexAt } from "./prep";

const a = args();
const rounds = (a.rounds ?? "1,2,3").split(",");
const LENSES = ["textbook", "trader", "skeptic"];
type Row = { id: string; v: Record<string, string>; det: boolean; state: string };
const rows: Row[] = [];
const benches = new Map<Market, Bars | null>();
for (const r of rounds) {
  const key = readJson<any[]>(join(DATA, "panel", "keys", `round${r}.json`)) ?? [];
  const rev = readJson<{ reviews: any[] }>(join(DATA, "panel", "keys", `round${r}.reviews.json`))?.reviews ?? [];
  for (const k of key) {
    const v: Record<string, string> = {};
    for (const x of rev.filter((x) => x.id === k.id)) v[x.lens] = x.verdict;
    if (LENSES.some((l) => !v[l])) continue;
    if (!benches.has(k.market)) benches.set(k.market, readJson<Bars>(benchPath(k.market)));
    const b = loadBars(k.market, k.symbol)!;
    const res = analyze(b, indicators(b, benches.get(k.market) ?? undefined), indexAt(b, k.date));
    rows.push({ id: `r${r}${k.id}`, v, det: !!res?.valid, state: res?.state ?? "" });
  }
}
const acc = (s: string) => s !== "no";
const pct = (n: number, d: number) => ((n / d) * 100).toFixed(0) + "%";
console.log(`${rows.length} charts judged by all three readers (rounds ${rounds.join(", ")})\n`);
console.log("Reader against reader (accept = yes or borderline):");
for (let i = 0; i < 3; i++)
  for (let j = i + 1; j < 3; j++) {
    const same = rows.filter((r) => acc(r.v[LENSES[i]]) === acc(r.v[LENSES[j]])).length;
    console.log(`  ${LENSES[i].padEnd(8)} vs ${LENSES[j].padEnd(8)} ${pct(same, rows.length)}`);
  }
console.log("\nEach reader against the other two (charts where those two agree with each other):");
for (const l of LENSES) {
  const others = LENSES.filter((x) => x !== l);
  const base = rows.filter((r) => acc(r.v[others[0]]) === acc(r.v[others[1]]));
  const same = base.filter((r) => acc(r.v[l]) === acc(r.v[others[0]])).length;
  console.log(`  ${l.padEnd(8)} ${pct(same, base.length)} of ${base.length}`);
}
console.log("\nDetector against each reader, and against pairs of readers who agree:");
for (const l of LENSES) console.log(`  vs ${l.padEnd(8)} ${pct(rows.filter((r) => r.det === acc(r.v[l])).length, rows.length)}`);
for (let i = 0; i < 3; i++)
  for (let j = i + 1; j < 3; j++) {
    const base = rows.filter((r) => acc(r.v[LENSES[i]]) === acc(r.v[LENSES[j]]));
    console.log(`  vs ${LENSES[i]}+${LENSES[j]} (agreeing) ${pct(base.filter((r) => r.det === acc(r.v[LENSES[i]])).length, base.length)} of ${base.length}`);
  }
const unan = rows.filter((r) => LENSES.every((l) => acc(r.v[l])) || LENSES.every((l) => !acc(r.v[l])));
console.log(`  vs all three unanimous ${pct(unan.filter((r) => r.det === acc(r.v.textbook)).length, unan.length)} of ${unan.length}`);
