import type { Bars } from "./types";

/** Simple moving average. NaN until `n` values are available. */
export function sma(x: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

/** Exponential moving average seeded with the SMA of the first `n` values. */
export function ema(x: ArrayLike<number>, n: number): Float64Array {
  const out = new Float64Array(x.length).fill(NaN);
  if (x.length < n) return out;
  const k = 2 / (n + 1);
  let s = 0;
  for (let i = 0; i < n; i++) s += x[i];
  let e = s / n;
  out[n - 1] = e;
  for (let i = n; i < x.length; i++) {
    e = x[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Rolling extreme over the trailing `n` bars including the current one. Uses what exists early on. */
function rollingExtreme(x: ArrayLike<number>, n: number, max: boolean): Float64Array {
  const out = new Float64Array(x.length);
  const dq = new Int32Array(x.length);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < x.length; i++) {
    while (tail > head && (max ? x[dq[tail - 1]] <= x[i] : x[dq[tail - 1]] >= x[i])) tail--;
    dq[tail++] = i;
    if (dq[head] <= i - n) head++;
    out[i] = x[dq[head]];
  }
  return out;
}
export const rollingMax = (x: ArrayLike<number>, n: number) => rollingExtreme(x, n, true);
export const rollingMin = (x: ArrayLike<number>, n: number) => rollingExtreme(x, n, false);

/** Median of x[a..b] inclusive. */
export function median(x: ArrayLike<number>, a: number, b: number): number {
  const n = b - a + 1;
  if (n <= 0) return NaN;
  const tmp = new Float64Array(n);
  for (let i = 0; i < n; i++) tmp[i] = x[a + i];
  tmp.sort();
  return n % 2 ? tmp[(n - 1) / 2] : (tmp[n / 2 - 1] + tmp[n / 2]) / 2;
}

export function mean(x: ArrayLike<number>, a: number, b: number): number {
  if (b < a) return NaN;
  let s = 0;
  for (let i = a; i <= b; i++) s += x[i];
  return s / (b - a + 1);
}

/** Everything the detector reads, precomputed once per symbol. All series are causal. */
export interface Ind {
  sma50: Float64Array;
  sma150: Float64Array;
  sma200: Float64Array;
  ema21: Float64Array;
  /** 52-week high of highs / low of lows, including the current bar. */
  hi252: Float64Array;
  lo252: Float64Array;
  /** 50-day average volume (needs 20 bars minimum, then grows to 50). */
  vol50: Float64Array;
  /** True range as a fraction of the prior close. */
  tr: Float64Array;
  /** RS rating 1..99, NaN when unavailable. */
  rs: Float64Array;
  /** Close divided by benchmark close, NaN when no benchmark. */
  rsLine: Float64Array;
}

export function indicators(B: Bars, bench?: { d: number[]; c: number[] }): Ind {
  const n = B.c.length;
  const tr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const pc = i > 0 ? B.c[i - 1] : B.o[i];
    tr[i] = (Math.max(B.h[i], pc) - Math.min(B.l[i], pc)) / pc;
  }
  const vol50 = new Float64Array(n).fill(NaN);
  let vs = 0;
  for (let i = 0; i < n; i++) {
    vs += B.v[i];
    if (i >= 50) vs -= B.v[i - 50];
    if (i >= 19) vol50[i] = vs / Math.min(i + 1, 50);
  }
  const rs = new Float64Array(n).fill(NaN);
  if (B.rs) for (let i = 0; i < n; i++) if (B.rs[i] > 0) rs[i] = B.rs[i];

  const rsLine = new Float64Array(n).fill(NaN);
  if (bench) {
    let j = 0;
    let last = NaN;
    for (let i = 0; i < n; i++) {
      while (j < bench.d.length && bench.d[j] <= B.d[i]) last = bench.c[j++];
      if (last > 0) rsLine[i] = B.c[i] / last;
    }
  }
  return {
    sma50: sma(B.c, 50),
    sma150: sma(B.c, 150),
    sma200: sma(B.c, 200),
    ema21: ema(B.c, 21),
    hi252: rollingMax(B.h, 252),
    lo252: rollingMin(B.l, 252),
    vol50,
    tr,
    rs,
    rsLine,
  };
}
