/**
 * Render a chart to PNG without a browser, using the same drawing code as the app.
 *
 *   npm run render -- --market us --symbol NFLX --date 2009-10-13
 *   npm run render -- --market in --symbol CUPID --plain            (no detector marks)
 *   npm run render -- --market us --symbol NFLX --date 2009-10-13 --future 40
 *   npm run render -- --list jobs.json                              ([{market,symbol,date?,out?,plain?,future?,bars?}])
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import type { Bars, Market } from "../engine/types";
import { indicators } from "../engine/indicators";
import { analyze } from "../engine/vcp";
import { ChartCore, type Ctx } from "../src/chart/core";
import { DARK, LIGHT } from "../src/chart/theme";
import { DATA, args, benchPath, loadBars, readJson } from "./store";
import { indexAt, parseDate } from "./prep";

export interface RenderJob {
  market: Market;
  symbol: string;
  /** YYYY-MM-DD or YYYYMMDD; default the latest bar. */
  date?: string | number;
  out?: string;
  /** Hide the detector's reading. */
  plain?: boolean;
  /** Sessions after the as-of date to show, ghosted. */
  future?: number;
  /** Frame exactly this many bars before the as-of date. */
  bars?: number;
  dark?: boolean;
  width?: number;
  height?: number;
  /** Pixel density of the output (default 2). */
  scale?: number;
}

const BENCH_NAME: Record<string, string> = { "^GSPC": "S&P 500", "^CRSLDX": "Nifty 500", "^NSEI": "Nifty 50" };
const benches = new Map<Market, Bars | null>();

export function render(job: RenderJob): { path: string; date: number } {
  const b = loadBars(job.market, job.symbol);
  if (!b) throw new Error(`no bars for ${job.market}/${job.symbol}`);
  if (!b.rs) throw new Error(`${job.symbol} has no RS ratings yet. Run: npm run scan -- --market ${job.market}`);
  if (!benches.has(job.market)) benches.set(job.market, readJson<Bars>(benchPath(job.market)));
  const bench = benches.get(job.market) ?? null;
  const t = job.date ? indexAt(b, parseDate(String(job.date))) : b.d.length - 1;
  if (t < 0) throw new Error(`${job.symbol} has no bar on or before ${job.date}`);
  const future = Math.max(0, job.future ?? 0);
  // The chart must not be able to show what the detector could not see.
  const view: Bars = future >= b.d.length - 1 - t ? b : slice(b, t + future + 1);
  const ind = indicators(view, bench ?? undefined);
  const analysis = analyze(view, ind, t);

  const w = job.width ?? 1400;
  const h = job.height ?? 900;
  const dpr = job.scale ?? 2;
  const core = new ChartCore();
  core.fontFamily = '"Helvetica Neue", Helvetica, Arial, sans-serif';
  core.size(w, h, dpr);
  core.opt = {
    log: true,
    candles: false,
    swings: false,
    theme: job.dark ? DARK : LIGHT,
    overlay: !job.plain,
    frameBars: job.bars ?? (job.plain ? 250 : undefined),
  };
  core.set({ bars: view, ind, analysis, asOf: t, showFuture: future > 0, benchName: bench ? (BENCH_NAME[bench.symbol] ?? bench.symbol) : undefined }, true);
  const base = createCanvas(Math.round(w * dpr), Math.round(h * dpr));
  const over = createCanvas(Math.round(w * dpr), Math.round(h * dpr));
  core.draw(base.getContext("2d") as unknown as Ctx);
  core.drawOverlay(over.getContext("2d") as unknown as Ctx);
  const g = base.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(over, 0, 0);
  // Title strip is part of the image so a picture is self-describing.
  const out = job.out ?? join(DATA, "shots", `${job.market}-${b.symbol}-${view.d[t]}${job.plain ? "-plain" : ""}.png`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, base.toBuffer("image/png"));
  return { path: out, date: view.d[t] };
}

function slice(b: Bars, n: number): Bars {
  return { ...b, d: b.d.slice(0, n), o: b.o.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n), v: b.v.slice(0, n), rs: b.rs?.slice(0, n) };
}

if (process.argv[1]?.endsWith("render.ts")) {
  const a = args();
  const jobs: RenderJob[] = a.list
    ? JSON.parse(readFileSync(a.list, "utf8"))
    : [
        {
          market: (a.market ?? "us") as Market,
          symbol: (a.symbol ?? "").toUpperCase(),
          date: a.date,
          out: a.out,
          plain: a.plain === "true",
          future: a.future ? Number(a.future) : 0,
          bars: a.bars ? Number(a.bars) : undefined,
          dark: a.dark === "true",
        },
      ];
  for (const j of jobs) {
    try {
      const r = render(j);
      console.log(r.path);
    } catch (e) {
      console.log(`failed ${j.market}/${j.symbol}: ${(e as Error).message}`);
    }
  }
}
