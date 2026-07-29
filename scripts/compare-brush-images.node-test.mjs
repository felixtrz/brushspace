import assert from "node:assert/strict";
import test from "node:test";

import { compareBrushImagePixels } from "./compare-brush-images.mjs";

test("measures brush silhouettes and RGB error", () => {
  const actual = new Uint8Array([
    10, 20, 30, 255,
    0, 0, 0, 255,
  ]);
  const reference = new Uint8Array([
    10, 10, 30, 255,
    10, 10, 10, 255,
  ]);
  const result = compareBrushImagePixels(actual, reference, 2, 1);

  assert.equal(result.actual.coveredPixelRatio, 0.5);
  assert.equal(result.reference.coveredPixelRatio, 1);
  assert.deepEqual(result.actual.bounds, [0, 0, 0, 0]);
  assert.deepEqual(result.reference.bounds, [0, 0, 1, 0]);
  assert.equal(result.silhouetteIntersectionOverUnion, 0.5);
  assert.ok(result.meanAbsoluteDifference > 0);
  assert.ok(result.rootMeanSquareDifference > result.meanAbsoluteDifference);
});

test("handles two blank images", () => {
  const blank = new Uint8Array(4);
  const result = compareBrushImagePixels(blank, blank, 1, 1);
  assert.equal(result.silhouetteIntersectionOverUnion, 1);
  assert.equal(result.actual.bounds, null);
  assert.equal(result.reference.centroid, null);
});
