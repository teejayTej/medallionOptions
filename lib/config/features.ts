/**
 * V5 feature flags. All default to false. V4 logic is the fallback path
 * when a flag is off. Flip in staging only after the brief's per-phase
 * acceptance criteria are met. Flip in production only after live
 * validation against paper trades.
 */
export const FEATURES = {
  /**
   * V5_SCORING stays OFF. Reason: 4 of the 6 PerfectSetupInputs fields
   * (netDeltaZ, persistenceDays, cumulativeAbnormalOI, hasConcurrent-
   * OppositeLeg5m) emit safe defaults at runtime because we don't yet
   * have a persistence layer. Flipping the flag would tank live scores
   * vs V4 by ~20-40 points (we tested — funnel produces 0 entries
   * instead of expected count). Re-enable after persistence ships.
   *
   * UI cards still surface flowSignal / deltaProfile / archetype /
   * contrarian / borrowFee — those fields are always populated on
   * WhaleAlert regardless of this flag.
   */
  V5_SCORING: false,
  V5_CONTRACT_RULES: false,
  V5_EXITS: false,
  V5_PORTFOLIO: false,
  V5_FUNNEL: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
