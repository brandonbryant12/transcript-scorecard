import { describe, expect, it } from "vitest"
import { computeWeightedScore, estimateSystemOneCostUsd, SYSTEM_ONE_PRICING } from "./index"

describe("computeWeightedScore", () => {
  it("normalizes rubric sizes before applying weights", () => {
    expect(
      computeWeightedScore([
        { rawScore: 4, maxScore: 4, weight: 2 },
        { rawScore: 1, maxScore: 2, weight: 1 },
      ]),
    ).toBe(83.3)
  })

  it("returns zero with no active criteria", () => {
    expect(computeWeightedScore([{ rawScore: 3, maxScore: 0, weight: 1 }])).toBe(0)
  })
})

describe("estimateSystemOneCostUsd", () => {
  it("uses the published per-million input rate without per-request rounding", () => {
    expect(estimateSystemOneCostUsd(1, 900)).toBe(0.000000042)
    expect(estimateSystemOneCostUsd(123_456, 99_999)).toBeCloseTo(0.005185152, 12)
    expect(SYSTEM_ONE_PRICING).toMatchObject({
      inputUsdPerMillion: 0.042,
      outputUsdPerMillion: 0,
      checkedAt: "2026-09-16",
    })
  })
})
