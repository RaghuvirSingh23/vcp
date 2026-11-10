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
  /** Volatility must at least halve from the first contraction to the last. */
  maxOverallRatio: number;
  /** The pivot needs a few sessions of tight action before it is a pivot. */
  minFinalBars: number;
  /**
   * A pullback counts as a contraction only if it is deeper than `noiseMult` times the
   * median daily true range of the stretch it sits in, and never less than `noiseFloor`.
   * Scaling by the local bar size is what lets a 3% pivot count in a quiet stock while a
   * 3% wiggle in a wild one does not.
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
  minFinalBars: 3,
  noiseMult: 1.5,
  noiseFloor: 0.02,
  buyZone: 0.05,
  rsMin: 70,
  aboveLowMin: 0.3,
  belowHighMax: 0.25,
  breakoutVolMult: 1.4,
  dryUpMax: 1.0,
  fractal: 5,
};
