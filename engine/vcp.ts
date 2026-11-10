/**
 * Volatility Contraction Pattern detector.
 *
 * Everything here reads bars[0..t] only. Nothing after `t` is touched, so the same
 * function serves the live scan, the chart replay and the backtest.
 *
 * How a base is read
 * ------------------
 * 1. Left-side high. Candidates are swing highs in the last 65 weeks that no later bar
 *    has exceeded by more than the failed-breakout tolerance. The base starts at the
 *    earliest one that can be a base at all: preceded by an advance, not too long, not
 *    too deep. The contraction rules are then applied to that whole consolidation. A
 *    later high is never substituted because the full base failed them: months of
 *    equal swings do not become a VCP by ignoring everything but the last one.
 * 2. First contraction: left-side high down to the lowest low of the base. A base whose
 *    body holds more than one swing (a double bottom, a shakeout under an earlier low)
 *    is still one first contraction: what matters is what the stock does after it.
 * 3. Every later contraction is the largest high-to-low pullback in what remains after
 *    the previous contraction's low. This is the hierarchy a chart reader applies by
 *    eye: the dominant pullback first, then the dominant pullback of what is left.
 *    Pullbacks on the way back up, smaller than the contraction that follows them,
 *    are part of the recovery and are not counted. Nor is a pullback that starts in
 *    the lower half of the base: that is the low being retested, not a contraction.
 * 4. The recursion stops when the largest remaining pullback is no bigger than the
 *    local bar noise. What is left is the pivot area.
 *
 * Because each contraction is the maximum over a region nested inside the previous
 * one, contractions after the first can only get smaller. The decomposition therefore
 * cannot by itself tell a VCP from a random walk; the checks do that: how much the
 * depth shrank, how tight the last one is, whether volume and daily ranges dried up,
 * and whether the stock is in a Stage 2 uptrend to begin with.
 */
import type { Bars } from "./types";
import type { Ind } from "./indicators";
import { mean, median } from "./indicators";
import { argMin, maxDrawdown, maxRunup } from "./swings";
import { DEFAULTS, type Params } from "./config";

export type State = "forming" | "ready" | "breakout" | "extended";
export type Kind = "classic" | "cheat" | "low-cheat";
export type CheckGroup = "trend" | "base" | "contraction" | "volume";

export interface Contraction {
  /** 1-based position, left to right. */
  n: number;
  /** Bar index of the high and of the low. */
  hi: number;
  lo: number;
  high: number;
  low: number;
  /** (high - low) / high. */
  depth: number;
  /** Bars from the high to the low. */
  downBars: number;
  /** Last bar of this contraction's span: the next contraction's high, or the pivot area's last bar. */
  end: number;
  /** Mean volume over the span relative to the 50-day average at its end. */
  volRatio: number;
  /** A rally inside the decline that retraced at least half of it before price made the final low. */
  shakeout?: { lowIdx: number; low: number; reboundIdx: number; rebound: number };
}

export interface Check {
  id: string;
  group: CheckGroup;
  label: string;
  value: string;
  want: string;
  /** null = not applicable (not enough history, or rating not computed). */
  pass: boolean | null;
  /** Required checks decide validity. The rest only move the score. */
  required: boolean;
}

export interface Analysis {
  t: number;
  date: number;
  close: number;
  /** All required checks pass. */
  valid: boolean;
  state: State;
  kind: Kind;
  /** Fewer than 252 bars of history: trend checks that need more are not applicable. */
  young: boolean;
  /** 0..100, quality of a valid setup. Meaningless when invalid. */
  score: number;
  /** A = valid with no weakness; B = valid with the weaknesses listed; null = not valid. */
  grade: "A" | "B" | null;
  /** Ids of the grade-A conditions a valid setup misses. */
  weaknesses: string[];
  /** Minervini's shorthand: weeks, deepest/tightest contraction, count. e.g. "12W 24/4 3T". */
  footprint: string;
  base: {
    start: number;
    high: number;
    lowIdx: number;
    low: number;
    depth: number;
    bars: number;
    weeks: number;
    priorLowIdx: number;
    priorLow: number;
    priorAdvance: number;
  };
  contractions: Contraction[];
  pivot: number;
  pivotIdx: number;
  stop: number;
  /** Pivot to stop, as a fraction of the pivot. */
  riskPct: number;
  /** Pivot relative to the close: positive = still below the pivot. */
  distPct: number;
  breakout?: { idx: number; date: number; volRatio: number; closedAbove: boolean; barsAgo: number };
  checks: Check[];
  /** Ids of required checks that failed. */
  failed: string[];
  metrics: {
    noise: number;
    dryUp: number;
    lowDay: number;
    rangeContraction: number;
    recentRange: number;
    pivotPos: number;
    finalBars: number;
    rs: number;
  };
}

const pc = (x: number, d = 1) => (Number.isFinite(x) ? (x * 100).toFixed(d) + "%" : "n/a");
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Smallest pullback that counts as a contraction in the stretch [from, to]. */
function noiseAt(I: Ind, from: number, to: number, P: Params): number {
  const a = Math.max(1, Math.min(from, to - 9));
  const m = median(I.tr, a, to);
  return Math.max(P.noiseFloor, P.noiseMult * (Number.isFinite(m) ? m : 0));
}

/** Minervini's Trend Template, evaluated at bar t. */
export function trendChecks(B: Bars, I: Ind, t: number, P: Params = DEFAULTS): { checks: Check[]; young: boolean } {
  const c = B.c[t];
  const m50 = I.sma50[t];
  const m150 = I.sma150[t];
  const m200 = I.sma200[t];
  const m200Prev = t >= 21 ? I.sma200[t - 21] : NaN;
  const longBars = P.trendMonths * 21;
  const m200Long = t >= longBars ? I.sma200[t - longBars] : NaN;
  const m50Prev = t >= 10 ? I.sma50[t - 10] : NaN;
  const m150Prev = t >= 21 ? I.sma150[t - 21] : NaN;
  const hi = I.hi252[t];
  const lo = I.lo252[t];
  const rs = I.rs[t];
  const young = t < 252;
  const has = (...xs: number[]) => xs.every((x) => Number.isFinite(x));
  const mk = (id: string, label: string, ok: boolean | null, value: string, want: string): Check => ({
    id,
    group: "trend",
    label,
    value,
    want,
    pass: ok,
    required: true,
  });
  const checks: Check[] = [
    mk(
      "tt1",
      has(m200) ? "Price above 150- and 200-day MA" : "Price above 150-day MA",
      has(m150, m200) ? c > m150 && c > m200 : has(m150) ? c > m150 : null,
      has(m150, m200) ? `${num(c)} vs ${num(m150)} / ${num(m200)}` : has(m150) ? `${num(c)} vs ${num(m150)}` : "n/a",
      "above",
    ),
    mk(
      "tt2",
      "150-day MA above 200-day MA",
      has(m150, m200) ? m150 > m200 : null,
      has(m150, m200) ? `${num(m150)} vs ${num(m200)}` : "n/a",
      "150 > 200",
    ),
    mk(
      "tt3",
      has(m200) ? `200-day MA rising, and above ${P.trendMonths} months ago` : "150-day MA rising",
      has(m200, m200Prev)
        ? m200 > m200Prev && (has(m200Long) ? m200 > m200Long : true)
        : has(m150, m150Prev)
          ? m150 > m150Prev
          : null,
      has(m200, m200Prev)
        ? pc(m200 / m200Prev - 1, 1) + " in a month" + (has(m200Long) ? ", " + pc(m200 / m200Long - 1, 0) + ` in ${P.trendMonths}` : "")
        : has(m150, m150Prev)
          ? pc(m150 / m150Prev - 1, 1) + " in a month"
          : "n/a",
      "rising",
    ),
    mk(
      "tt4",
      has(m200) ? "50-day MA above 150- and 200-day MA" : "50-day MA above 150-day MA",
      has(m50, m150, m200) ? m50 > m150 && m50 > m200 : has(m50, m150) ? m50 > m150 : null,
      has(m50, m150, m200) ? `${num(m50)} vs ${num(m150)} / ${num(m200)}` : has(m50, m150) ? `${num(m50)} vs ${num(m150)}` : "n/a",
      "above",
    ),
    mk("tt5", "Price above 50-day MA", has(m50) ? c > m50 : null, has(m50) ? `${num(c)} vs ${num(m50)}` : "n/a", "above"),
    mk(
      "tt5b",
      "50-day MA not falling",
      has(m50, m50Prev) ? m50 >= m50Prev * (1 - P.ma50Slack) : null,
      has(m50, m50Prev) ? pc(m50 / m50Prev - 1, 1) + " in 10 sessions" : "n/a",
      "flat or rising",
    ),
    mk("tt6", "Above 52-week low", c / lo - 1 >= P.aboveLowMin, pc(c / lo - 1, 0), `≥ ${pc(P.aboveLowMin, 0)}`),
    mk("tt7", "Below 52-week high", 1 - c / hi <= P.belowHighMax, pc(1 - c / hi, 0), `≤ ${pc(P.belowHighMax, 0)}`),
    mk("tt8", "RS rating", has(rs) ? rs >= P.rsMin : null, has(rs) ? String(Math.round(rs)) : "n/a", `≥ ${P.rsMin}`),
  ];
  return { checks, young };
}

interface Reading {
  s: number;
  /** Lowest low of the base and the fall to it from the left-side high. */
  lowIdx: number;
  depth: number;
  cons: Contraction[];
  bo: number;
  endF: number;
  priorLowIdx: number;
  priorLow: number;
  priorAdvance: number;
  structural: Check[];
  fails: number;
  /** Can be a base at all: follows an advance, and is neither too long nor too deep. */
  isBase: boolean;
}

/** Swing highs that could be the left-side high of a base still in force at t, earliest first. */
function candidates(B: Bars, t: number, P: Params): number[] {
  const { h } = B;
  const from = Math.max(0, t - P.maxBaseBars);
  const out: number[] = [];
  let sufMax = h[t];
  for (let i = t - 1; i >= from; i--) {
    // sufMax = highest high after i
    if (sufMax <= h[i] * (1 + P.failedBreakoutTol)) {
      let peak = true;
      for (let k = 1; k <= P.fractal && peak; k++) {
        if (i - k >= 0 && h[i - k] > h[i]) peak = false;
        if (i + k <= t && h[i + k] >= h[i]) peak = false;
      }
      if (peak) out.push(i);
    }
    if (h[i] > sufMax) sufMax = h[i];
  }
  return out.reverse();
}

/** Read the base that starts at swing high `s`, as of bar `t`. */
function read(B: Bars, I: Ind, s: number, t: number, P: Params): Reading | null {
  const { h, l, c, v } = B;
  const l1 = argMin(l, s, t);
  if (l1 === s) return null;
  // The left-side high is the highest high before the base low. If a later bar matches
  // or beats it before the low, that bar is the proper start and is its own candidate.
  for (let i = s + 1; i <= l1; i++) if (h[i] >= h[s]) return null;
  const d1 = (h[s] - l[l1]) / h[s];
  if (d1 < noiseAt(I, s + 1, t, P)) return null;

  const cons: Contraction[] = [];
  const push = (p: number, q: number) =>
    cons.push({
      n: cons.length + 1,
      hi: p,
      lo: q,
      high: h[p],
      low: l[q],
      depth: (h[p] - l[q]) / h[p],
      downBars: q - p,
      end: q,
      volRatio: NaN,
    });
  push(s, l1);
  const mid = (h[s] + l[l1]) / 2;
  let k = l1;
  for (;;) {
    // A bar that makes the low and closes in its upper half reversed intraday, so its own
    // high may start the next contraction. Otherwise the next high comes after it.
    const a = c[k] > (h[k] + l[k]) / 2 ? k : k + 1;
    if (a >= t) break;
    const md = maxDrawdown(h, l, a, t);
    if (!md || md.depth < noiseAt(I, k + 1, t, P)) break;
    // A pullback from the lower half of the base is the low being retested (the second
    // leg of a double bottom), part of the base forming rather than a contraction.
    const prev = cons[cons.length - 1];
    const floor = P.nestedRetest ? Math.max(mid, (prev.high + prev.low) / 2) : mid;
    if (h[md.p] >= floor) push(md.p, md.q);
    k = md.q;
  }
  // First bar after a contraction's low that trades above its high.
  const breakoutOf = (c: Contraction): number => {
    for (let j = c.lo + 1; j <= t; j++) if (h[j] > c.high) return j;
    return -1;
  };
  // A contraction only a few sessions old is not yet a pivot. While the one before it is
  // intact it remains the pivot, and the young dip is simply part of its pivot area.
  let bo = breakoutOf(cons[cons.length - 1]);
  while (cons.length >= 2) {
    const c = cons[cons.length - 1];
    if ((bo >= 0 ? bo - 1 : t) - c.hi >= P.minFinalBars) break;
    cons.pop();
    bo = breakoutOf(cons[cons.length - 1]);
  }
  // Keep the contractions that share the pivot's resistance (the first is the base itself).
  if (P.resistance) {
    for (let i = cons.length - 2; i >= 1; i--) {
      let later = 0;
      for (let j = i + 1; j < cons.length; j++) later = Math.max(later, cons[j].high);
      if (later > cons[i].high * (1 + P.failedBreakoutTol)) cons.splice(i, 1);
    }
    cons.forEach((x, i) => (x.n = i + 1));
  }
  const K = cons.length;
  const last = cons[K - 1];
  const endF = bo >= 0 ? bo - 1 : t;
  for (let i = 0; i < K; i++) {
    const con = cons[i];
    con.end = i < K - 1 ? cons[i + 1].hi : Math.max(endF, con.lo);
    con.volRatio = mean(v, con.hi, con.end) / I.vol50[con.end];
    // The low must come after the high's own bar: that bar's low may predate its high.
    const ru = maxRunup(h, l, con.hi + 1, con.lo);
    if (ru && ru.gain >= noiseAt(I, con.hi + 1, con.lo, P)) {
      const drop = con.high - l[ru.q];
      const rally = h[ru.p] - l[ru.q];
      if (drop > 0 && rally / drop >= 0.5) {
        con.shakeout = { lowIdx: ru.q, low: l[ru.q], reboundIdx: ru.p, rebound: h[ru.p] };
      }
    }
  }

  // The advance into the base: walk left until a clearly higher high or the lookback ends.
  let priorLow = Infinity;
  let priorLowIdx = -1;
  const lim = Math.max(0, s - P.priorAdvanceLookback);
  for (let j = s - 1; j >= lim; j--) {
    if (h[j] > h[s] * (1 + P.failedBreakoutTol)) break;
    if (l[j] < priorLow) {
      priorLow = l[j];
      priorLowIdx = j;
    }
  }
  const priorAdvance = priorLowIdx >= 0 ? h[s] / priorLow - 1 : 0;
  const fromBelow = priorLowIdx >= 0 && priorLow < l[l1];
  const deepest = Math.max(...cons.map((x) => x.depth));
  // How far under the base's high the pivot sits, against the room the base allows.
  const baseHigh = Math.max(...cons.map((x) => x.high));
  const pivotGap = (baseHigh - last.high) / baseHigh;
  const gapAllowed = Math.max(d1 * P.pivotGapShare, P.pivotGapMin);

  const bars = (bo >= 0 ? bo : t) - s;
  const finalBars = endF - last.hi;
  const mk = (id: string, group: CheckGroup, label: string, ok: boolean, value: string, want: string): Check => ({
    id,
    group,
    label,
    value,
    want,
    pass: ok,
    required: true,
  });
  // Each step must contract. How clearly depends on how deep the swings still are:
  // from `stepDeep` up, to no more than `maxStepRatio` of the one before; easing
  // linearly to "merely not larger" once the earlier one is within pivot tightness.
  const allowedStep = (prev: number) => {
    const w = (P.stepDeep - prev) / (P.stepDeep - P.maxFinalDepth);
    return P.maxStepRatio + (1 - P.maxStepRatio) * Math.min(1, Math.max(0, w));
  };
  let stepsOk = true;
  for (let i = 1; i < K; i++) {
    if (cons[i].depth > cons[i - 1].depth * allowedStep(cons[i - 1].depth)) stepsOk = false;
  }
  const structural: Check[] = [
    mk(
      "b_len",
      "base",
      "Base length",
      bars >= P.minBaseBars && bars <= P.maxBaseBars,
      `${bars} bars (${Math.round(bars / 5)}w)`,
      `${P.minBaseBars / 5}–${P.maxBaseBars / 5} weeks`,
    ),
    mk(
      "b_depth",
      "base",
      "Base depth",
      d1 <= P.maxBaseDepth && d1 >= P.minBaseDepth,
      pc(d1),
      P.minBaseDepth > 0 ? `${pc(P.minBaseDepth, 0)}–${pc(P.maxBaseDepth, 0)}` : `≤ ${pc(P.maxBaseDepth, 0)}`,
    ),
    mk(
      "b_adv",
      "base",
      "Prior advance into the base",
      fromBelow && priorAdvance >= P.minPriorAdvance,
      fromBelow ? "+" + pc(priorAdvance, 0) : "none from below the base",
      `≥ +${pc(P.minPriorAdvance, 0)}`,
    ),
    mk("c_count", "contraction", "Contractions", K >= 2, String(K), "≥ 2"),
    mk(
      "c_step",
      "contraction",
      "Each contraction smaller than the last",
      stepsOk,
      cons.map((x) => pc(x.depth, 0)).join(" → "),
      "each clearly smaller",
    ),
    mk(
      "c_ratio",
      "contraction",
      "Final vs deepest contraction",
      K >= 2 && last.depth <= P.maxOverallRatio * deepest,
      K >= 2 ? num(last.depth / deepest) + "×" : "n/a",
      `≤ ${num(P.maxOverallRatio)}×`,
    ),
    mk(
      "c_pos",
      "contraction",
      "Pivot near the top of the base",
      pivotGap <= gapAllowed,
      pc(pivotGap) + " under the base high",
      `≤ ${pc(gapAllowed)}`,
    ),
    mk(
      "c_tight",
      "contraction",
      "Final contraction depth",
      last.depth <= P.maxFinalDepth,
      pc(last.depth),
      `≤ ${pc(P.maxFinalDepth, 0)}`,
    ),
    mk(
      "c_reach",
      "contraction",
      "Within reach of the pivot",
      bo >= 0 || last.high / c[t] - 1 <= P.maxPivotDistance,
      bo >= 0 ? "through it" : pc(last.high / c[t] - 1) + " below",
      Number.isFinite(P.maxPivotDistance) ? `≤ ${pc(P.maxPivotDistance, 0)}` : "any",
    ),
    mk(
      "c_bars",
      "contraction",
      "Sessions since the pivot high",
      finalBars >= P.minFinalBars,
      String(finalBars),
      `≥ ${P.minFinalBars}`,
    ),
  ];
  const fails = structural.reduce((n, x) => n + (x.pass === false ? 1 : 0), 0);
  // A marginal new high followed by a deeper fall than the base had seen begins a new
  // base at that high; the earlier, shallower consolidation is behind it.
  const superseded = cons.some((x, i) => i > 0 && x.depth > cons[0].depth);
  const isBase = !superseded && bars <= P.maxBaseBars && d1 <= P.maxBaseDepth && fromBelow && priorAdvance >= P.minPriorAdvance;
  return { s, lowIdx: l1, depth: d1, cons, bo, endF, priorLowIdx, priorLow, priorAdvance, structural, fails, isBase };
}

export interface AnalyzeOptions {
  /** Return null without reading the base when the Trend Template fails. For the backtest loop. */
  trendGate?: boolean;
}

/**
 * Read the chart as of bar `t`. Returns null when there is no base to read at all
 * (too little history, or price at a fresh high with no pullback behind it).
 */
export function analyze(B: Bars, I: Ind, t: number, P: Params = DEFAULTS, opts: AnalyzeOptions = {}): Analysis | null {
  if (t < 40 || t >= B.c.length) return null;
  const { checks: trend, young } = trendChecks(B, I, t, P);
  if (opts.trendGate && trend.some((x) => x.pass === false)) return null;

  // The base is the earliest candidate that can be one. If none can, show the earliest
  // reading so the chart still explains itself.
  let best: Reading | null = null;
  for (const s of candidates(B, t, P)) {
    const r = read(B, I, s, t, P);
    if (!r) continue;
    if (r.isBase) {
      best = r;
      break;
    }
    if (!best) best = r;
  }
  if (!best) return null;

  const { c, v, d } = B;
  const { cons, bo, endF } = best;
  const K = cons.length;
  const first = cons[0];
  const last = cons[K - 1];
  const pivot = last.high;
  const stop = last.low;
  const wA = last.hi + 1;
  const hasWindow = endF >= wA;

  // Volume through the pivot area, against the 50-day average the trader sees on the chart.
  const avg = I.vol50[endF];
  const dryUp = hasWindow ? mean(v, wA, endF) / avg : NaN;
  let minVol = Infinity;
  for (let i = wA; i <= endF; i++) if (v[i] < minVol) minVol = v[i];
  const lowDay = hasWindow ? minVol / avg : NaN;
  // Daily ranges at the pivot against daily ranges in the rest of the base.
  const rangeContraction =
    hasWindow && last.hi > best.s ? median(I.tr, wA, endF) / median(I.tr, best.s + 1, last.hi) : NaN;
  const pivotRange = hasWindow ? median(I.tr, wA, endF) : NaN;
  const baseRange = last.hi > best.s ? median(I.tr, best.s + 1, last.hi) : NaN;
  const recentRange = endF - 2 > best.s && baseRange > 0 ? median(I.tr, endF - 2, endF) / baseRange : NaN;
  const baseLow = B.l[best.lowIdx];
  const span = first.high - baseLow;
  const pivotPos = span > 0 ? (pivot - baseLow) / span : 1;
  const kind: Kind = pivotPos >= 2 / 3 ? "classic" : pivotPos >= 1 / 3 ? "cheat" : "low-cheat";

  const volume: Check[] = [
    {
      id: "v_dry",
      group: "volume",
      label: "Volume through the final contraction",
      value: Number.isFinite(dryUp) ? num(dryUp) + "× 50-day avg" : "n/a",
      want: `< ${num(P.dryUpMax)}×`,
      pass: Number.isFinite(dryUp) ? dryUp < P.dryUpMax : null,
      required: true,
    },
    {
      id: "v_low",
      group: "volume",
      label: "Quietest session at the pivot",
      value: Number.isFinite(lowDay) ? num(lowDay) + "× 50-day avg" : "n/a",
      want: "≤ 0.60×",
      pass: Number.isFinite(lowDay) ? lowDay <= 0.6 : null,
      required: false,
    },
    {
      id: "v_range",
      group: "volume",
      label: "Daily range at the pivot vs rest of base",
      value: Number.isFinite(rangeContraction) ? num(rangeContraction) + "×" : "n/a",
      want: `≤ ${num(P.maxRangeRatio)}×`,
      pass: Number.isFinite(rangeContraction) ? rangeContraction <= P.maxRangeRatio : null,
      required: false,
    },
    {
      id: "v_recent",
      group: "volume",
      label: "Last three sessions' range vs the base",
      value: Number.isFinite(recentRange) ? num(recentRange) + "×" : "n/a",
      want: Number.isFinite(P.maxRecentRange) ? `≤ ${num(P.maxRecentRange)}×` : "reported",
      pass: Number.isFinite(recentRange) ? recentRange <= P.maxRecentRange : null,
      required: Number.isFinite(P.maxRecentRange),
    },
    {
      id: "v_pin",
      group: "volume",
      label: "Price is trading freely",
      value: Number.isFinite(pivotRange) ? pc(pivotRange, 2) + " a day" : "n/a",
      want: `> ${pc(P.pinRange, 1)} a day`,
      pass: Number.isFinite(pivotRange) ? !(pivotRange < P.pinRange || rangeContraction < P.pinRatio) : null,
      required: true,
    },
  ];
  // Grade-A conditions. None decides validity; together they decide the grade.
  const longBars = P.trendMonths * 21;
  const trendGain = t >= longBars && I.sma200[t - longBars] === I.sma200[t - longBars] ? I.sma200[t] / I.sma200[t - longBars] - 1 : NaN;
  const q = (id: string, group: CheckGroup, label: string, ok: boolean | null, value: string, want: string): Check => ({
    id,
    group,
    label,
    value,
    want,
    pass: ok,
    required: false,
  });
  const quality: Check[] = [
    q("q_trend", "trend", `200-day MA gain over ${P.trendMonths} months`, Number.isFinite(trendGain) ? trendGain >= P.gradeTrend : null, pc(trendGain, 0), `≥ ${pc(P.gradeTrend, 0)}`),
    q("q_depth", "base", "Base depth in the constructive range", best.depth <= P.idealBaseDepth, pc(best.depth), `≤ ${pc(P.idealBaseDepth, 0)}`),
    q("q_count", "contraction", "Three or more contractions", K >= P.gradeCount, String(K), `≥ ${P.gradeCount}`),
    q("q_final", "contraction", "Final contraction tight", last.depth <= P.gradeFinalDepth, pc(last.depth), `≤ ${pc(P.gradeFinalDepth, 0)}`),
    q("q_dry", "volume", "Volume clearly dried up", Number.isFinite(dryUp) ? dryUp <= P.gradeDryUp : null, Number.isFinite(dryUp) ? num(dryUp) + "×" : "n/a", `≤ ${num(P.gradeDryUp)}×`),
  ];
  const checks = [...trend, ...best.structural, ...quality, ...volume];
  const failed = checks.filter((x) => x.required && x.pass === false).map((x) => x.id);
  // A required check that could not be evaluated blocks validity unless the stock is simply too young for it.
  const unknown = checks.some((x) => x.required && x.pass === null && !(young && x.group === "trend"));
  const valid = failed.length === 0 && !unknown;
  // A condition that cannot be evaluated (a stock too young for a five-month trend) is a weakness.
  const weaknesses = valid ? quality.filter((x) => x.pass !== true).map((x) => x.id) : [];
  const grade = !valid ? null : weaknesses.length === 0 ? "A" : "B";

  // Score: how textbook the setup is. Each part is 0..1.
  const rs = I.rs[t];
  let prog = 0;
  for (let i = 1; i < K; i++) prog += clamp01((0.95 - cons[i].depth / cons[i - 1].depth) / 0.35);
  prog = K > 1 ? prog / (K - 1) : 0;
  const sTight = clamp01((P.maxFinalDepth - last.depth) / (P.maxFinalDepth - 0.04));
  const sDry = Number.isFinite(dryUp) ? clamp01((1 - dryUp) / 0.4) : 0;
  const sLow = Number.isFinite(lowDay) ? clamp01((0.8 - lowDay) / 0.4) : 0;
  const sRange = Number.isFinite(rangeContraction) ? clamp01((1 - rangeContraction) / 0.5) : 0;
  const sRs = Number.isFinite(rs) ? clamp01((rs - 70) / 29) : 0;
  const sDepth =
    best.depth <= P.idealBaseDepth ? 1 : clamp01((P.maxBaseDepth - best.depth) / (P.maxBaseDepth - P.idealBaseDepth));
  const sPos = clamp01((pivotPos - 1 / 3) / (2 / 3 - 1 / 3));
  const score = Math.round(
    25 * sTight + 20 * prog + 10 * sDry + 10 * sLow + 10 * sRange + 15 * sRs + 5 * sDepth + 5 * sPos,
  );

  const close = c[t];
  let state: State;
  if (bo >= 0) state = close > pivot * (1 + P.buyZone) ? "extended" : "breakout";
  // Ready = back in the upper half of the final contraction; below that it is still pulling back.
  else state = close >= (pivot + stop) / 2 ? "ready" : "forming";

  const endRef = bo >= 0 ? bo : t;
  const bars = endRef - best.s;
  const weeks = Math.max(1, Math.round(bars / 5));
  const footprint = `${weeks}W ${Math.round(best.depth * 100)}/${Math.round(last.depth * 100)} ${K}T`;

  return {
    t,
    date: d[t],
    close,
    valid,
    state,
    kind,
    young,
    score,
    grade,
    weaknesses,
    footprint,
    base: {
      start: best.s,
      high: first.high,
      lowIdx: best.lowIdx,
      low: baseLow,
      depth: best.depth,
      bars,
      weeks,
      priorLowIdx: best.priorLowIdx,
      priorLow: best.priorLow,
      priorAdvance: best.priorAdvance,
    },
    contractions: cons,
    pivot,
    pivotIdx: last.hi,
    stop,
    riskPct: (pivot - stop) / pivot,
    distPct: pivot / close - 1,
    breakout:
      bo >= 0
        ? {
            idx: bo,
            date: d[bo],
            volRatio: v[bo] / I.vol50[Math.max(0, bo - 1)],
            closedAbove: c[bo] > pivot,
            barsAgo: t - bo,
          }
        : undefined,
    checks,
    failed,
    metrics: {
      noise: noiseAt(I, last.lo + 1, t, P),
      dryUp,
      lowDay,
      rangeContraction,
      recentRange,
      pivotPos,
      finalBars: endF - last.hi,
      rs,
    },
  };
}

