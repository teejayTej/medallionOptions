/**
 * V5 feature flags. All default to false. V4 logic is the fallback path
 * when a flag is off. Flip in staging only after the brief's per-phase
 * acceptance criteria are met. Flip in production only after live
 * validation against paper trades.
 */
export const FEATURES = {
  V5_SCORING: false,
  V5_CONTRACT_RULES: false,
  V5_EXITS: false,
  V5_PORTFOLIO: false,
  V5_FUNNEL: false,
} as const;

export type FeatureFlag = keyof typeof FEATURES;
