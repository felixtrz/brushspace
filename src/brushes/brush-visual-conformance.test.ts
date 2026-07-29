import { describe, expect, it } from "vitest";

import { compareRgbPixels } from "./brush-pixel-difference.js";

describe("compareRgbPixels", () => {
  it("reports no visual change for identical renders", () => {
    expect(compareRgbPixels(new Uint8Array(8), new Uint8Array(8))).toEqual({
      comparedPixelRatio: 0,
      changedPixelRatio: 0,
      meanAbsoluteDifference: 0,
      rootMeanSquareDifference: 0,
    });
  });

  it("measures RGB changes while ignoring alpha", () => {
    const result = compareRgbPixels(
      new Uint8Array([10, 20, 30, 0, 20, 20, 20, 255]),
      new Uint8Array([0, 20, 30, 255, 20, 20, 20, 0]),
    );
    expect(result.changedPixelRatio).toBe(0.5);
    expect(result.comparedPixelRatio).toBe(1);
    expect(result.meanAbsoluteDifference).toBeCloseTo(10 / 6);
    expect(result.rootMeanSquareDifference).toBeCloseTo(Math.sqrt(100 / 6));
  });

  it("rejects mismatched pixel buffers", () => {
    expect(() => compareRgbPixels(new Uint8Array(4), new Uint8Array(8))).toThrow(
      "equally sized RGBA",
    );
  });
});
