/**
 * Walk-forward signal study.
 *
 * For every bar t the detector reads bars[0..t-1]. If that reading is a valid VCP
 * that has not yet broken out, a buy-stop rests at its pivot for bar t. Whatever
 * happens on and after bar t is outcome, never input.
 *
 * This is deliberately not a strategy lab. There is one reference trade plan, the
 * textbook one, used only to turn each signal into a comparable outcome:
 *
 *   entry   buy-stop at the pivot; filled at the open if the stock gaps above it
 *   stop    the low of the final contraction, capped at `maxRisk` below entry
 *   exit    the stop, or the first close under the 50-day average (sold next open)
 *
 * Forward returns at fixed horizons are recorded alongside, with the benchmark's
 * return over the same sessions, so the signals can be judged without any exit rule.
 */
import type { Bars } from "./types";
import type { Ind } from "./indicators";
import { sma } from "./indicators";
import { analyze, type Analysis } from "./vcp";
import { DEFAULTS, type Params } from "./config";

export const HORIZONS = [5, 10, 20, 60] as const;

export interface Signal {
  symbol: string;
  /** Last bar the detector saw. */
  setupDate: number;
  /** Bar on which price traded through the pivot. */
  date: number;
  pivot: number;
  /** Final-contraction low: the pattern's own stop. */
  patternStop: number;
  /** Stop actually used (pattern stop, or the risk cap if that is closer). */
  stop: number;
  entry: number;
  /** Entry above the pivot, as a fraction (0 unless the open gapped over it). */
  gap: number;
  /** (entry - stop) / entry. */
  risk: number;
  /** Open gapped beyond the buy zone. Recorded, but a chaser's trade, not the pattern's. */
  chase: boolean;
  footprint: string;
  /** A = no weakness, B = valid with one or more. */
  grade: "A" | "B";
  weaknesses: string[];
  score: number;
  count: number;
  firstDepth: number;
  lastDepth: number;
  weeks: number;
  kind: string;
  rs: number;
  dryUp: number;
  rangeRatio: number;
  /** Breakout-day volume over the 50-day average as it stood the day before. */
  volRatio: number;
  /** Breakout day closed above the pivot. */
  held: boolean;
  /** Benchmark above its own 200-day average on the setup date (null = no benchmark data). */
  uptrend: boolean | null;
  /** Close-to-entry return after 5/10/20/60 sessions; null when the data ends first. */
  fwd: (number | null)[];
  /** Benchmark return over the same sessions. */
  bench: (number | null)[];
  /** Best and worst excursion from entry over the next 60 sessions. */
  mfe: number;
  mae: number;
  exitDate: number;
  exit: number;
  reason: "stop" | "trend" | "open";
  /** Result in units of initial risk. */
  r: number;
  ret: number;
  hold: number;
}

export interface BenchRef {
  d: number[];
  c: number[];
  sma200: Float64Array;
}

export function benchRef(bench: { d: number[]; c: number[] } | null): BenchRef | null {
  return bench ? { d: bench.d, c: bench.c, sma200: sma(bench.c, 200) } : null;
}

function lastOnOrBefore(d: number[], date: number): number {
  let lo = 0;
  let hi = d.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (d[m] <= date) (ans = m), (lo = m + 1);
    else hi = m - 1;
  }
  return ans;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

export interface BacktestOptions {
  /** First setup date considered, YYYYMMDD. */
  from?: number;
  /** Largest risk taken on a trade, as a fraction of entry. */
  maxRisk?: number;
}

/** Every pivot breakout in one stock's history, with what followed. */
export function signalsFor(B: Bars, I: Ind, bench: BenchRef | null, P: Params = DEFAULTS, opt: BacktestOptions = {}): Signal[] {
  const out: Signal[] = [];
  const n = B.c.length;
  const from = opt.from ?? 0;
  const maxRisk = opt.maxRisk ?? 0.1;
  const fired = new Set<number>();
  let armed: Analysis | null = null;

  for (let t = 60; t < n; t++) {
    if (armed && !fired.has(armed.pivotIdx) && B.h[t] > armed.pivot) {
      fired.add(armed.pivotIdx);
      out.push(outcome(B, I, bench, armed, t, P, maxRisk));
    }
    if (B.d[t] < from) {
      armed = null;
      continue;
    }
    const a = analyze(B, I, t, P, { trendGate: true });
    armed = a && a.valid && !a.breakout ? a : null;
  }
  return out;
}

function outcome(B: Bars, I: Ind, bench: BenchRef | null, a: Analysis, t: number, P: Params, maxRisk: number): Signal {
  const n = B.c.length;
  const pivot = a.pivot;
  const entry = Math.max(B.o[t], pivot);
  const stop = Math.max(a.stop, entry * (1 - maxRisk));
  const risk = (entry - stop) / entry;

  // Reference trade.
  let exitIdx = -1;
  let exit = NaN;
  let reason: Signal["reason"] = "open";
  // Entry day: a low under the stop only counts if it plausibly came after the fill.
  if (B.l[t] <= stop && (B.o[t] > pivot || B.c[t] < pivot)) {
    exitIdx = t;
    exit = stop;
    reason = "stop";
  }
  for (let j = t + 1; exitIdx < 0 && j < n; j++) {
    if (B.o[j] <= stop) {
      exitIdx = j;
      exit = B.o[j];
      reason = "stop";
    } else if (B.l[j] <= stop) {
      exitIdx = j;
      exit = stop;
      reason = "stop";
    } else if (B.c[j] < I.sma50[j]) {
      // Decision is made on the close; the sale happens at the next open.
      if (j + 1 < n) {
        exitIdx = j + 1;
        exit = B.o[j + 1];
        // A gap under the stop the next morning is still a stop-out at the open.
        reason = "trend";
      } else {
        exitIdx = j;
        exit = B.c[j];
        reason = "open";
      }
    }
  }
  if (exitIdx < 0) {
    exitIdx = n - 1;
    exit = B.c[n - 1];
    reason = "open";
  }

  // Forward returns and excursions, independent of the exit rule.
  const bi = bench ? lastOnOrBefore(bench.d, B.d[t - 1]) : -1;
  const fwd: (number | null)[] = [];
  const bfwd: (number | null)[] = [];
  for (const hz of HORIZONS) {
    const j = t + hz;
    fwd.push(j < n ? r4(B.c[j] / entry - 1) : null);
    if (bench && bi >= 0 && j < n) {
      const bj = lastOnOrBefore(bench.d, B.d[j]);
      bfwd.push(bj >= 0 ? r4(bench.c[bj] / bench.c[bi] - 1) : null);
    } else bfwd.push(null);
  }
  let mfe = 0;
  let mae = 0;
  for (let j = t; j < Math.min(n, t + 60); j++) {
    mfe = Math.max(mfe, B.h[j] / entry - 1);
    // On the entry day only the part of the bar after the fill can hurt; the close bounds it from above.
    const low = j === t ? Math.min(B.c[j], entry) : B.l[j];
    mae = Math.min(mae, low / entry - 1);
  }

  const uptrend = bench && bi >= 0 && bench.sma200[bi] === bench.sma200[bi] ? bench.c[bi] > bench.sma200[bi] : null;
  const last = a.contractions[a.contractions.length - 1];
  return {
    symbol: B.symbol,
    setupDate: B.d[t - 1],
    date: B.d[t],
    pivot,
    patternStop: a.stop,
    stop: r4(stop),
    entry: r4(entry),
    gap: r4(entry / pivot - 1),
    risk: r4(risk),
    chase: entry > pivot * (1 + P.buyZone),
    footprint: a.footprint,
    grade: a.grade === "A" ? "A" : "B",
    weaknesses: a.weaknesses,
    score: a.score,
    count: a.contractions.length,
    firstDepth: r4(a.base.depth),
    lastDepth: r4(last.depth),
    weeks: a.base.weeks,
    kind: a.kind,
    rs: Math.round(a.metrics.rs) || 0,
    dryUp: r4(a.metrics.dryUp),
    rangeRatio: r4(a.metrics.rangeContraction),
    volRatio: r4(B.v[t] / I.vol50[t - 1]),
    held: B.c[t] > pivot,
    uptrend,
    fwd,
    bench: bfwd,
    mfe: r4(mfe),
    mae: r4(mae),
    exitDate: B.d[exitIdx],
    exit: r4(exit),
    reason,
    r: r4((exit - entry) / (entry - stop)),
    ret: r4(exit / entry - 1),
    hold: exitIdx - t,
  };
}

export interface Summary {
  n: number;
  winRate: number;
  avgR: number;
  medianR: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  avgHold: number;
  avgRisk: number;
  /** Per horizon: mean, median, share positive, mean excess over benchmark, count. */
  horizons: { bars: number; mean: number; median: number; positive: number; excess: number; n: number }[];
}

const avg = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : NaN);
function med(x: number[]): number {
  if (!x.length) return NaN;
  const s = [...x].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

export function summarize(sig: Signal[]): Summary {
  // Open trades have no result yet; they stay out of the trade statistics.
  const closed = sig.filter((s) => s.reason !== "open");
  const rs = closed.map((s) => s.r);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const gross = wins.reduce((s, v) => s + v, 0);
  const lost = -losses.reduce((s, v) => s + v, 0);
  return {
    n: closed.length,
    winRate: closed.length ? wins.length / closed.length : NaN,
    avgR: avg(rs),
    medianR: med(rs),
    avgWinR: avg(wins),
    avgLossR: avg(losses),
    profitFactor: lost > 0 ? gross / lost : NaN,
    avgHold: avg(closed.map((s) => s.hold)),
    avgRisk: avg(closed.map((s) => s.risk)),
    horizons: HORIZONS.map((bars, k) => {
      const have = sig.filter((s) => s.fwd[k] !== null);
      const f = have.map((s) => s.fwd[k] as number);
      const ex = have.filter((s) => s.bench[k] !== null).map((s) => (s.fwd[k] as number) - (s.bench[k] as number));
      return {
        bars,
        mean: avg(f),
        median: med(f),
        positive: f.length ? f.filter((v) => v > 0).length / f.length : NaN,
        excess: avg(ex),
        n: f.length,
      };
    }),
  };
}
