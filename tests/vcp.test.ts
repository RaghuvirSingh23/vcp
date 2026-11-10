import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Bars } from "../engine/types";
import { indicators } from "../engine/indicators";
import { analyze } from "../engine/vcp";
import { signalsFor } from "../engine/backtest";
import { maxDrawdown, maxRunup, zigzag } from "../engine/swings";

const fixture = (name: string): Bars => JSON.parse(readFileSync(join(__dirname, "fixtures", name + ".json"), "utf8"));
const at = (b: Bars, date: number) => b.d.lastIndexOf(date);
const read = (name: string, date: number) => {
  const b = fixture(name);
  return { b, r: analyze(b, indicators(b), at(b, date)) };
};
const depths = (r: NonNullable<ReturnType<typeof analyze>>) => r.contractions.map((c) => Math.round(c.depth * 100));

describe("published setups read as published", () => {
  // Minervini, Trade Like a Stock Market Wizard: "6W 32/6 3T". The third contraction
  // measures 6.6% high to low; the base is five weeks old the day before the breakout.
  it("MercadoLibre, December 2007", () => {
    const { b, r } = read("MELI-20071207", 20071207);
    expect(r?.valid).toBe(true);
    expect(depths(r!)).toEqual([32, 16, 7]);
    expect(r!.pivot).toBeCloseTo(45.84, 2);
    expect(r!.stop).toBeCloseTo(42.81, 2);
    // It breaks out the next session.
    const next = analyze(b, indicators(b), at(b, 20071210))!;
    expect(next.breakout?.date).toBe(20071210);
  });

  it("Netflix, October 2009", () => {
    const { r } = read("NFLX-20091013", 20091013);
    expect(r?.valid).toBe(true);
    expect(r!.footprint).toBe("26W 28/8 3T");
  });

  it("TASER, January 2004", () => {
    const { r } = read("AXON-20040108", 20040108);
    expect(r?.valid).toBe(true);
    expect(r!.footprint).toBe("4W 16/7 3T");
  });

  it("Lululemon, November 2010", () => {
    const { r } = read("LULU-20101104", 20101104);
    expect(r?.valid).toBe(true);
    expect(r!.footprint).toBe("20W 33/5 3T");
  });

  it("NVIDIA, January 2024", () => {
    const { r } = read("NVDA-20240105", 20240105);
    expect(r?.valid).toBe(true);
    expect(r!.footprint).toBe("18W 22/6 3T");
  });
});

describe("charts a reader rejects are rejected", () => {
  it("a pivot at the bottom of the base is not a pivot (Wockhardt, November 2026)", () => {
    const { r } = read("WOCKPHARMA-20261109", 20261109);
    expect(r?.valid).toBe(false);
  });

  it("a takeover target pinned to its bid is not contracting (BWIN, November 2026)", () => {
    const { r } = read("BWIN-20261109", 20261109);
    expect(r?.valid).toBe(false);
  });

  it("months of equal swings are not laundered into a short base (DHT, July 2026)", () => {
    const { r } = read("DHT-20260730", 20260730);
    expect(r?.valid).toBe(false);
    expect(r!.failed).toContain("c_step");
  });

  it("one pause halfway up a base, under a falling 50-day (OZK, June 2014)", () => {
    const { r } = read("OZK-20140616", 20140616);
    expect(r?.valid).toBe(false);
  });
});

describe("nothing after the as-of bar is read", () => {
  for (const [name, date] of [
    ["NVDA-20240105", 20240105],
    ["LULU-20101104", 20101104],
    ["NFLX-20091013", 20091013],
  ] as const) {
    it(`${name}: truncating the history changes nothing`, () => {
      const b = fixture(name);
      const t = at(b, date);
      for (const k of [t - 40, t - 7, t]) {
        const cut: Bars = { ...b, d: b.d.slice(0, k + 1), o: b.o.slice(0, k + 1), h: b.h.slice(0, k + 1), l: b.l.slice(0, k + 1), c: b.c.slice(0, k + 1), v: b.v.slice(0, k + 1), rs: b.rs!.slice(0, k + 1) };
        expect(analyze(cut, indicators(cut), k)).toEqual(analyze(b, indicators(b), k));
      }
    });
  }

  it("the backtest fires on the breakout bar with a setup read the day before", () => {
    const b = fixture("MELI-20071207");
    const s = signalsFor(b, indicators(b), null).find((x) => x.date === 20071210)!;
    expect(s).toBeDefined();
    expect(s.setupDate).toBe(20071207);
    expect(s.pivot).toBeCloseTo(45.84, 2);
    // Buy-stop at the pivot: the open was below it, so the fill is the pivot.
    expect(s.entry).toBeCloseTo(45.84, 2);
    expect(s.patternStop).toBeCloseTo(42.81, 2);
  });
});

// ── synthetic paths ──

/** Bars along straight lines between [bar, price] waypoints, with a small fixed wick and constant volume. */
function path(points: [number, number][], volume: (i: number) => number = () => 1e6): Bars {
  const n = points[points.length - 1][0] + 1;
  const c: number[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const [i0, p0] = points[k];
    const [i1, p1] = points[k + 1];
    for (let i = i0; i < i1; i++) c[i] = p0 + ((p1 - p0) * (i - i0)) / (i1 - i0);
  }
  c[n - 1] = points[points.length - 1][1];
  const b: Bars = { symbol: "SYN", market: "us", name: "Synthetic", currency: "USD", d: [], o: [], h: [], l: [], c, v: [], rs: [] };
  for (let i = 0; i < n; i++) {
    const o = i ? c[i - 1] : c[0];
    b.o.push(o);
    b.h.push(Math.max(o, c[i]) * 1.004);
    b.l.push(Math.min(o, c[i]) * 0.996);
    b.d.push(20200101 + i);
    b.v.push(volume(i));
    b.rs!.push(90);
  }
  return b;
}

describe("synthetic bases", () => {
  // A year-long advance from 40 to 100, then 25% / 12% / 6% / 3% pullbacks with quiet volume at the end.
  const textbook: [number, number][] = [
    [0, 40], [300, 100], [330, 75], [350, 96], [362, 84.5], [374, 95], [382, 89.3], [390, 94.5], [396, 91.7], [401, 93.6],
  ];

  it("reads a textbook 4T base", () => {
    const b = path(textbook, (i) => (i > 386 ? 4e5 : 1e6));
    const r = analyze(b, indicators(b), b.c.length - 1)!;
    expect(r.contractions.length).toBe(4);
    expect(depths(r)).toEqual([26, 13, 7, 4]);
    expect(r.valid).toBe(true);
    expect(r.breakout).toBeUndefined();
    expect(r.pivot).toBeCloseTo(94.5 * 1.004, 1);
  });

  it("rejects the same base when volume does not dry up", () => {
    const b = path(textbook, (i) => (i > 386 ? 1.5e6 : 1e6));
    const r = analyze(b, indicators(b), b.c.length - 1)!;
    expect(r.valid).toBe(false);
    expect(r.failed).toContain("v_dry");
  });

  it("rejects equal swings: 25% then 24% is wide and loose, not a contraction", () => {
    const b = path([[0, 40], [300, 100], [330, 75], [350, 99], [372, 75.5], [392, 97], [398, 93.5], [404, 96]], (i) => (i > 392 ? 4e5 : 1e6));
    const r = analyze(b, indicators(b), b.c.length - 1)!;
    expect(r.valid).toBe(false);
  });

  it("rejects a tight pause low in the base", () => {
    const b = path([[0, 40], [300, 100], [330, 70], [345, 82], [352, 78.5], [359, 81.5]], (i) => (i > 345 ? 4e5 : 1e6));
    const r = analyze(b, indicators(b), b.c.length - 1)!;
    expect(r.valid).toBe(false);
  });

  it("reports a breakout on the bar that trades through the pivot, and never earlier", () => {
    const b = path([...textbook, [404, 98]], (i) => (i > 386 && i < 402 ? 4e5 : 2e6));
    const I = indicators(b);
    const before = analyze(b, I, 401)!;
    expect(before.breakout).toBeUndefined();
    const after = analyze(b, I, 404)!;
    expect(after.breakout).toBeDefined();
    expect(b.h[after.breakout!.idx]).toBeGreaterThan(after.pivot);
    expect(b.h[after.breakout!.idx - 1]).toBeLessThanOrEqual(after.pivot);
  });
});

describe("structural invariants on random walks", () => {
  function walk(seed: number, n = 900): Bars {
    let s = seed;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const b: Bars = { symbol: "RW", market: "us", name: "Random", currency: "USD", d: [], o: [], h: [], l: [], c: [], v: [], rs: [] };
    let p = 50;
    for (let i = 0; i < n; i++) {
      const o = p * (1 + (rnd() - 0.5) * 0.01);
      const c = o * (1 + (rnd() - 0.47) * 0.05);
      b.o.push(o);
      b.c.push(c);
      b.h.push(Math.max(o, c) * (1 + rnd() * 0.012));
      b.l.push(Math.min(o, c) * (1 - rnd() * 0.012));
      b.v.push(Math.round(5e5 + rnd() * 1e6));
      b.d.push(20200101 + i);
      b.rs!.push(80);
      p = c;
    }
    return b;
  }

  it("every reading is internally consistent", () => {
    let read = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const b = walk(seed * 7919);
      const I = indicators(b);
      for (let t = 300; t < b.c.length; t += 7) {
        const r = analyze(b, I, t);
        if (!r) continue;
        read++;
        const cs = r.contractions;
        expect(cs.length).toBeGreaterThan(0);
        for (let i = 0; i < cs.length; i++) {
          const c = cs[i];
          expect(c.hi).toBeLessThan(c.lo);
          expect(c.lo).toBeLessThanOrEqual(t);
          expect(c.depth).toBeCloseTo((b.h[c.hi] - b.l[c.lo]) / b.h[c.hi], 12);
          // In time order, and after the base low no contraction undercuts the one before.
          if (i > 0) {
            expect(c.hi).toBeGreaterThanOrEqual(cs[i - 1].lo);
            expect(c.low).toBeGreaterThanOrEqual(cs[i - 1].low);
          }
        }
        const last = cs[cs.length - 1];
        expect(r.pivot).toBe(last.high);
        expect(r.stop).toBe(last.low);
        expect(r.close).toBeGreaterThanOrEqual(r.stop);
        if (r.breakout) expect(b.h[r.breakout.idx]).toBeGreaterThan(r.pivot);
        else for (let j = last.lo + 1; j <= t; j++) expect(b.h[j]).toBeLessThanOrEqual(r.pivot);
        expect(r.valid).toBe(r.failed.length === 0 && r.checks.every((c) => !c.required || c.pass !== null || (r.young && c.group === "trend")));
      }
    }
    expect(read).toBeGreaterThan(200);
  });
});

describe("swing primitives", () => {
  const h = [10, 12, 11, 13, 9, 10, 8, 11];
  const l = [9, 11, 10, 12, 8, 9, 7, 10];
  it("maxDrawdown finds the deepest high-to-low fall with the high first", () => {
    expect(maxDrawdown(h, l, 0, 7)).toEqual({ p: 3, q: 6, depth: (13 - 7) / 13 });
    expect(maxDrawdown(h, l, 6, 7)).toBeNull();
  });
  it("maxRunup finds the largest low-to-high rally with the low first", () => {
    const r = maxRunup(h, l, 0, 7)!;
    expect([r.q, r.p]).toEqual([6, 7]);
    expect(r.gain).toBeCloseTo(11 / 7 - 1, 12);
  });
  it("zigzag alternates highs and lows", () => {
    const z = zigzag(h, l, 0, 7, 0.15);
    for (let i = 1; i < z.length; i++) expect(z[i].kind).not.toBe(z[i - 1].kind);
  });
});
