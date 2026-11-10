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
  /** A base is a correction, not a wiggle in an advance: its deepest point must be at least this far under its high. */
  minBaseDepth: number;
  /**
   * A contraction is over once price has won back half of it. A pullback that starts
   * lower than that is the previous low being retested, not the next contraction.
   * (The same rule against the whole base is always applied.)
   */
  nestedRetest: boolean;
  /**
   * Median true range of the last three sessions over the base's median. Above this
   * the right edge is still swinging: a dip that has bounced, not a pause.
   */
  maxRecentRange: number;
  /** The base must follow an advance. O'Neil/Minervini: at least ~30%. */
  minPriorAdvance: number;
  priorAdvanceLookback: number;
  /** The stop sits under the final contraction's low and risk is capped near 10%, so the pivot cannot be wider. */
  maxFinalDepth: number;
  /**
   * The last contraction against the deepest. "About half" is Minervini's rule of thumb
   * per step, so across a whole base anything short of roughly halving is not a
   * contraction; 0.6 leaves room for the two-step bases chart readers accept (15% then 8%).
   */
  maxOverallRatio: number;
  /**
   * The pivot forms near the top of the base: no further under its high than
   * `pivotGapShare` of the base's depth (Minervini's handle area is the upper third,
   * O'Neil's the upper half; readers accepted pivots down to about 0.37 and rejected
   * 0.39 and lower only for other reasons), or, for a base too shallow for that to
   * mean much, within `pivotGapMin` of the high.
   */
  pivotGapShare: number;
  pivotGapMin: number;
  /**
   * TLSMW: each contraction "about half, plus or minus a reasonable amount" of the one
   * before. A step from a deep contraction (`stepDeep` or more) that keeps more than
   * `maxStepRatio` of its depth is not a contraction: that is what wide and loose means.
   * The requirement eases as the swings get smaller and disappears once they are inside
   * pivot tightness, where two similar dips side by side are one tight shelf. Blind
   * chart readers accepted 24/11/9/4 and rejected 19/19/19/8/5; this is the rule that
   * agrees with both.
   */
  maxStepRatio: number;
  stepDeep: number;
  /**
   * A pivot is a pause, not a dip: this many sessions since its high. Four is the
   * shortest pivot in Minervini's own examples (MercadoLibre, December 2007:
   * high on the 3rd, breakout on the 10th).
   */
  minFinalBars: number;
  /**
   * Median daily true range in the pivot area over the median in the rest of the base.
   * Scored, not required: blind chart readers accepted clean bases this ratio rejected.
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
  /**
   * Trend Template (TLSMW ch. 5). Two readings of its spirit are made explicit: the
   * 200-day average must be above its level of `trendMonths` months ago (the book asks
   * for one month and prefers four to five), and the 50-day must not be falling by more
   * than `ma50Slack` over ten sessions, because a base is not complete while it is.
   */
  trendMonths: number;
  ma50Slack: number;
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
  minBaseDepth: 0,
  nestedRetest: false,
  maxRecentRange: Infinity,
  minPriorAdvance: 0.3,
  priorAdvanceLookback: 252,
  maxFinalDepth: 0.1,
  maxOverallRatio: 0.6,
  pivotGapShare: 0.4,
  pivotGapMin: 0.07,
  maxStepRatio: 0.75,
  stepDeep: 0.2,
  minFinalBars: 4,
  maxRangeRatio: 0.85,
  pinRange: 0.005,
  pinRatio: 0.2,
  noiseMult: 1.25,
  noiseFloor: 0.02,
  buyZone: 0.05,
  trendMonths: 5,
  ma50Slack: 0.01,
  rsMin: 70,
  aboveLowMin: 0.3,
  belowHighMax: 0.25,
  breakoutVolMult: 1.4,
  dryUpMax: 1.0,
  fractal: 5,
};
