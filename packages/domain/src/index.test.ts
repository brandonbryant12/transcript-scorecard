import { describe, expect, it } from "vitest"
import { computeWeightedScore } from "./index"

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
