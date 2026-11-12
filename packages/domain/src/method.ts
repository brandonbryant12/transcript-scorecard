// The method's tunable constants live in one place and are recorded on every evaluation
// through `version`, so results produced under different settings are never confused.
export const SCORING_METHOD = {
  version: 'moments-1',
  // A behaviour counts as detected in a turn at or above this probability.
  detectThreshold: 0.6,
  // A positive behaviour counts as "called for" at or above this probability.
  expectedThreshold: 0.5,
  // Below this share of observable scorecard weight, a live call has no overall score yet.
  minCoverage: 0.1,
  // A skill is routed to a human when the model's pick and the levels next to it hold
  // less than this share of the probability: it is torn between distant levels, which is
  // a different thing from hesitating between two neighbours.
  reviewAdjacentMass: 0.75,
  // At or above this observability a live skill is treated as judgeable for coaching.
  observableThreshold: 0.5,
  // Voice and words this many sentiment levels apart count as a mixed signal.
  mixedSignalLevels: 1,
  // Smallest valence change between customer turns that counts as a sentiment shift.
  shiftThreshold: 0.4,
} as const;
