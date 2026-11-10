/**
 * Swing primitives. Depths are measured the way Minervini measures a contraction:
 * intraday high to intraday low, as a fraction of the high.
 */

export interface Drawdown {
  /** Peak bar. */
  p: number;
  /** Trough bar, strictly after the peak. */
  q: number;
  depth: number;
}

/**
 * Largest peak-to-trough decline inside [a, b], peak strictly before trough.
 * Ties: the latest of equal peaks (the decline starts at the last touch of the high)
 * and the earliest of equal troughs (the low was made when it was first made).
 */
export function maxDrawdown(h: ArrayLike<number>, l: ArrayLike<number>, a: number, b: number): Drawdown | null {
  if (b <= a) return null;
  let pm = a;
  let best = 0;
  let bp = -1;
  let bq = -1;
  for (let j = a + 1; j <= b; j++) {
    const d = (h[pm] - l[j]) / h[pm];
    if (d > best) {
      best = d;
      bp = pm;
      bq = j;
    }
    if (h[j] >= h[pm]) pm = j;
  }
  return bp < 0 ? null : { p: bp, q: bq, depth: best };
}

export interface Runup {
  /** Trough bar. */
  q: number;
  /** Peak bar, strictly after the trough. */
  p: number;
  gain: number;
}

/** Largest trough-to-peak rally inside [a, b], trough strictly before peak. */
export function maxRunup(h: ArrayLike<number>, l: ArrayLike<number>, a: number, b: number): Runup | null {
  if (b <= a) return null;
  let qm = a;
  let best = 0;
  let bq = -1;
  let bp = -1;
  for (let j = a + 1; j <= b; j++) {
    const g = h[j] / l[qm] - 1;
    if (g > best) {
      best = g;
      bq = qm;
      bp = j;
    }
    if (l[j] <= l[qm]) qm = j;
  }
  return bq < 0 ? null : { q: bq, p: bp, gain: best };
}

export function argMin(x: ArrayLike<number>, a: number, b: number): number {
  let k = a;
  for (let i = a + 1; i <= b; i++) if (x[i] < x[k]) k = i;
  return k;
}

export function argMax(x: ArrayLike<number>, a: number, b: number): number {
  let k = a;
  for (let i = a + 1; i <= b; i++) if (x[i] > x[k]) k = i;
  return k;
}

export interface Swing {
  i: number;
  price: number;
  kind: "H" | "L";
}

/**
 * Percent-reversal zigzag over [a, b]. A turn is confirmed once price has moved
 * `pct` against the running extreme. The final swing is the unconfirmed running
 * extreme. Used for the minor-swing layer on the chart, not for the pattern itself.
 */
export function zigzag(h: ArrayLike<number>, l: ArrayLike<number>, a: number, b: number, pct: number): Swing[] {
  const out: Swing[] = [];
  if (b <= a) return out;
  let hi = a;
  let lo = a;
  let dir = 0;
  for (let j = a + 1; j <= b; j++) {
    if (dir >= 0 && h[j] >= h[hi]) hi = j;
    if (dir <= 0 && l[j] <= l[lo]) lo = j;
    if (dir === 0) {
      if ((h[hi] - l[j]) / h[hi] >= pct && hi < j) {
        out.push({ i: hi, price: h[hi], kind: "H" });
        dir = -1;
        lo = j;
      } else if (h[j] / l[lo] - 1 >= pct && lo < j) {
        out.push({ i: lo, price: l[lo], kind: "L" });
        dir = 1;
        hi = j;
      }
    } else if (dir > 0) {
      if ((h[hi] - l[j]) / h[hi] >= pct && hi < j) {
        out.push({ i: hi, price: h[hi], kind: "H" });
        dir = -1;
        lo = j;
      }
    } else if (h[j] / l[lo] - 1 >= pct && lo < j) {
      out.push({ i: lo, price: l[lo], kind: "L" });
      dir = 1;
      hi = j;
    }
  }
  if (dir > 0) out.push({ i: hi, price: h[hi], kind: "H" });
  else if (dir < 0) out.push({ i: lo, price: l[lo], kind: "L" });
  return out;
}
