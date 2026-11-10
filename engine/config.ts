/**
 * Every threshold the detector uses, in one place, with where it comes from.
 * "TLSMW" = Minervini, Trade Like a Stock Market Wizard (2013), ch. 5 and 10.
 */
export interface Params {
  /** Base length limits in trading bars. 3 to 65 weeks. */
  minBaseBars: number;
  maxBaseBars: number;
  /**
   * A later high may exceed the base's left-side high by this much and still belong to
   * the same base (a breakout attempt that fell back). 5% is the conventional buy zone:
   * beyond it the stock has left the base rather than failed at it.
   */
  failedBreakoutTol: number;
  /** TLSMW: most constructive bases correct 10-35%; deeper is acceptable only up to ~50%. */
  idealBaseDepth: number;
  maxBaseDepth: number;
  /** The base must follow an advance. O'Neil/Minervini: at least ~30%. */
  minPriorAdvance: number;
  priorAdvanceLookback: number;
  /** The stop sits under the final contraction's low and risk is capped near 10%, so the pivot cannot be wider. */
  maxFinalDepth: number;
  /** Volatility must at least halve from the deepest contraction to the last. */
  maxOverallRatio: number;
  /**
   * The pivot forms near the top of the base: within the upper third of its range
   * (Minervini's handle area; the middle and lower thirds are the "cheat" areas), or,
   * for a base too shallow for thirds to mean much, within this fraction of its high.
   */
  pivotGapMin: number;
  /**
   * TLSMW: each contraction "about half, plus or minus a reasonable amount" of the one
   * before. A step that keeps more than this fraction of the previous depth is not a
   * contraction. Steps between contractions that are both already inside the pivot
   * tightness are exempt: two 7% dips side by side are one tight shelf, not looseness.
   */
  maxStepRatio: number;
  /**
   * A pivot is a pause, not a dip: this many sessions since its high. Four is the
   * shortest pivot in Minervini's own examples (MercadoLibre, December 2007:
   * high on the 3rd, breakout on the 10th).
   */
  minFinalBars: number;
  /**
   * Median daily true range in the pivot area over the median in the rest of the base.
   * This is the volatility contraction itself, measured in bars rather than swings.
   */
  maxRangeRatio: number;
  /**
   * A price that barely moves at all is pinned (typically to a takeover bid), not
   * contracting: median daily range under `pinRange`, or under `pinRatio` of the base's.
   */
  pinRange: number;
  pinRatio: number;
  /**
   * A pullback counts as a contraction only if it is deeper than `noiseMult` times the
   * median daily true range of the stretch it sits in, and never less than `noiseFloor`.
   * Scaling by the local bar size is what lets a 3% pivot count in a quiet stock while a
   * 3% wiggle in a wild one does not. 1.25 is the largest multiple that still counts
   * the 6.6% third contraction Minervini marks on MercadoLibre in December 2007, when
   * the stock's median daily range was 4.6%.
   */
  noiseMult: number;
  noiseFloor: number;
  /** Buy zone above the pivot; past it the stock is extended. */
  buyZone: number;
  /** Trend Template (TLSMW ch. 5). */
  rsMin: number;
  aboveLowMin: number;
  belowHighMax: number;
  /** Breakout volume at least 40% above the 50-day average. */
  breakoutVolMult: number;
  /** Mean volume through the final contraction must sit under the 50-day average. */
  dryUpMax: number;
  /** Bars either side for a high to count as a candidate left-side high. */
  fractal: number;
}

export const DEFAULTS: Params = {
  minBaseBars: 15,
  maxBaseBars: 325,
  failedBreakoutTol: 0.05,
  idealBaseDepth: 0.35,
  maxBaseDepth: 0.5,
  minPriorAdvance: 0.3,
  priorAdvanceLookback: 252,
  maxFinalDepth: 0.1,
  maxOverallRatio: 0.5,
  pivotGapMin: 0.07,
  maxStepRatio: 0.75,
  minFinalBars: 4,
  maxRangeRatio: 0.85,
  pinRange: 0.005,
  pinRatio: 0.2,
  noiseMult: 1.25,
  noiseFloor: 0.02,
  buyZone: 0.05,
  rsMin: 70,
  aboveLowMin: 0.3,
  belowHighMax: 0.25,
  breakoutVolMult: 1.4,
  dryUpMax: 1.0,
  fractal: 5,
};
