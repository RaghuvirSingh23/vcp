/**
 * Build a blind review set: plain charts (no detector marks) with shuffled, anonymous
 * file names, plus a key the reviewers never see. Used to audit the detector against
 * independent chart readers.
 *
 *   npm run panel -- --round 1 --seed 7
 */
import { join } from "node:path";
import type { Bars, Market } from "../engine/types";
import type { Signal } from "../engine/backtest";
import { analyze } from "../engine/vcp";
import { DATA, args, readJson, writeJson } from "./store";
import { loadMarket } from "./prep";
import { render } from "./render";

interface Item {
  id: string;
  market: Market;
  symbol: string;
  date: number;
  /** valid = detector says VCP; near = one required check short; control = uptrend, no setup; down = fails the trend template; ref = published textbook case. */
  kind: "valid" | "near" | "control" | "down" | "ref";
  footprint: string;
  failed: string[];
  path: string;
}

const a = args();
const round = a.round ?? "1";
let seed = Number(a.seed ?? 7);
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const want = { valid: Number(a.valid ?? 15), near: Number(a.near ?? 10), control: Number(a.control ?? 6), down: Number(a.down ?? 3) };

const items: Omit<Item, "id" | "path">[] = [];
for (const market of ["us", "in"] as Market[]) {
  const M = loadMarket(market);
  const by = new Map<string, Bars>(M.all.map((b) => [b.symbol, b]));

  // Detector-valid: the bar before a recorded breakout, when the setup was armed.
  const bt = readJson<{ signals: Signal[] }>(join(DATA, "backtest", market + ".json"));
  const sig = (bt?.signals ?? []).filter((s) => s.setupDate >= 20120101 && !s.chase);
  const seen = new Set<string>();
  while (seen.size < Math.min(want.valid, sig.length)) {
    const s = pick(sig);
    if (seen.has(s.symbol)) continue;
    seen.add(s.symbol);
    items.push({ market, symbol: s.symbol, date: s.setupDate, kind: "valid", footprint: s.footprint, failed: [] });
  }

  // Random stock-days for the other classes.
  const need = { near: want.near, control: want.control, down: want.down };
  for (let guard = 0; guard < 40000 && need.near + need.control + need.down > 0; guard++) {
    const b = pick(M.all);
    if (b.d.length < 400 || seen.has(b.symbol)) continue;
    const t = 300 + Math.floor(rnd() * (b.d.length - 300));
    if (b.d[t] < 20120101) continue;
    const r = analyze(b, M.ind(b), t);
    if (!r) continue;
    const trendFails = r.failed.filter((f) => f.startsWith("tt")).length;
    let kind: "near" | "control" | "down" | null = null;
    if (trendFails === 0 && r.failed.length === 1 && !r.breakout) kind = "near";
    else if (trendFails === 0 && r.failed.length >= 3) kind = "control";
    else if (trendFails >= 3) kind = "down";
    if (!kind || need[kind] <= 0) continue;
    need[kind]--;
    seen.add(b.symbol);
    items.push({ market, symbol: b.symbol, date: b.d[t], kind, footprint: r.footprint, failed: r.failed });
  }

  if (market === "us" && a.refs !== "false") {
    // Setups documented in the literature or widely recognised, as positive controls.
    for (const [symbol, date] of [
      ["MELI", 20071207],
      ["NFLX", 20091013],
      ["LULU", 20101104],
      ["NVDA", 20240105],
      ["AXON", 20040108],
    ] as const) {
      if (by.has(symbol)) items.push({ market, symbol, date, kind: "ref", footprint: "", failed: [] });
    }
  }
}

// Shuffle so position says nothing about class.
for (let i = items.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [items[i], items[j]] = [items[j], items[i]];
}
const dir = join(DATA, "panel", "round" + round);
const key: Item[] = [];
items.forEach((it, i) => {
  const id = "c" + String(i + 1).padStart(3, "0");
  const path = join(dir, id + ".png");
  try {
    render({ market: it.market, symbol: it.symbol, date: it.date, plain: true, bars: Number(a.bars ?? 340), out: path, width: 1200, height: 780, scale: 1.5 });
    key.push({ ...it, id, path });
  } catch (e) {
    console.log(`skip ${it.symbol}: ${(e as Error).message}`);
  }
});
writeJson(join(dir, "key.json"), key);
const count = (k: string) => key.filter((x) => x.kind === k).length;
console.log(`round ${round}: ${key.length} charts in ${dir}`);
console.log(`  valid ${count("valid")}, near ${count("near")}, control ${count("control")}, down ${count("down")}, ref ${count("ref")}`);
