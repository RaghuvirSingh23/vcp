import type { Bars } from "./types";

/**
 * Weighted 12-month performance, the usual stand-in for IBD's RS score:
 * the latest quarter counts double. A stock younger than a window is measured
 * from its first bar for that window.
 */
export function rsRaw(c: ArrayLike<number>, i: number): number {
  if (i < 63) return NaN;
  const roc = (n: number) => c[i] / c[Math.max(0, i - n)] - 1;
  return 0.4 * roc(63) + 0.2 * roc(126) + 0.2 * roc(189) + 0.2 * roc(252);
}

/**
 * Percentile-rank every stock against the rest of the universe on every date and
 * store the result (1..99, 0 = not rated) on each Bars as `rs`. A rating on date D
 * uses closes up to D only.
 */
export function rateUniverse(all: Bars[]): void {
  const seen = new Set<number>();
  for (const b of all) for (const d of b.d) seen.add(d);
  const dates = [...seen].sort((x, y) => x - y);
  const at = new Map<number, number>();
  dates.forEach((d, i) => at.set(d, i));

  const raws = all.map((b) => {
    const r = new Float64Array(b.c.length);
    for (let i = 0; i < r.length; i++) r[i] = rsRaw(b.c, i);
    return r;
  });
  const start = new Int32Array(dates.length + 1);
  all.forEach((b, k) => {
    const r = raws[k];
    for (let i = 0; i < r.length; i++) if (r[i] === r[i]) start[at.get(b.d[i])! + 1]++;
  });
  for (let i = 0; i < dates.length; i++) start[i + 1] += start[i];
  const vals = new Float64Array(start[dates.length]);
  const fill = start.slice(0, dates.length);
  all.forEach((b, k) => {
    const r = raws[k];
    for (let i = 0; i < r.length; i++) if (r[i] === r[i]) vals[fill[at.get(b.d[i])!]++] = r[i];
  });
  for (let i = 0; i < dates.length; i++) vals.subarray(start[i], start[i + 1]).sort();

  all.forEach((b, k) => {
    const r = raws[k];
    const out = new Array<number>(r.length).fill(0);
    for (let i = 0; i < r.length; i++) {
      if (r[i] !== r[i]) continue;
      const di = at.get(b.d[i])!;
      const lo0 = start[di];
      const n = start[di + 1] - lo0;
      // Count of stocks strictly weaker, plus half of those tied.
      let lo = lo0;
      let hi = lo0 + n;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (vals[m] < r[i]) lo = m + 1;
        else hi = m;
      }
      let up = lo;
      while (up < lo0 + n && vals[up] === r[i]) up++;
      const pct = n > 1 ? ((lo - lo0) + (up - lo - 1) / 2) / (n - 1) : 0.5;
      out[i] = Math.min(99, Math.max(1, Math.round(1 + 98 * pct)));
    }
    b.rs = out;
  });
}
