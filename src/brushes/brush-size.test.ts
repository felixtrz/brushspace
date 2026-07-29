import { describe, expect, it } from "vitest";

import {
  OPEN_BRUSH_DEFAULT_BRUSH_SIZE_RANGE,
  OPEN_BRUSH_DEFAULT_SIZE01,
  OPEN_BRUSH_DEFAULT_STARTUP_BRUSH_SIZE_RANGE,
  OPEN_BRUSH_DEFAULT_STARTUP_LIVE_BRUSH_SIZE,
  OPEN_BRUSH_DEFAULT_STARTUP_SCREENSHOT_BRUSH_SIZE,
  OPEN_BRUSH_IWSDK_BRUSH_SIZE_SCALE,
  OPEN_BRUSH_UNITS_TO_METERS,
  brushSize01ToLiveBrushSize,
  brushSize01ToOpenBrushSize,
  liveBrushSizeToSize01,
  normalizeBrushSizeThumbstickAxis,
  normalizeBrushSize,
  normalizeBrushSize01,
  normalizeBrushSizeRange,
  openBrushSizeToBrushSize01,
  resolveBrushSize01Adjustment,
  resolveBrushSizeForBrushChange,
  resolveBrushSizeThumbstickAdjustment,
} from "./brush-size.js";

describe("Open Brush brush size", () => {
  it("converts Tilt Brush units (decimeters) to live meters 1:1", () => {
    expect(OPEN_BRUSH_DEFAULT_SIZE01).toBe(0.5);
    expect(OPEN_BRUSH_UNITS_TO_METERS).toBe(0.1);
    expect(OPEN_BRUSH_IWSDK_BRUSH_SIZE_SCALE).toBe(OPEN_BRUSH_UNITS_TO_METERS);
    expect(
      brushSize01ToLiveBrushSize(
        OPEN_BRUSH_DEFAULT_SIZE01,
        OPEN_BRUSH_DEFAULT_BRUSH_SIZE_RANGE,
      ),
    ).toBeCloseTo(0.9561862178478972 * 0.1);
  });

  it("uses the upstream Light brush for startup and fallback live size", () => {
    expect(OPEN_BRUSH_DEFAULT_STARTUP_BRUSH_SIZE_RANGE).toEqual([0.05, 0.2]);
    expect(
      brushSize01ToOpenBrushSize(
        OPEN_BRUSH_DEFAULT_SIZE01,
        OPEN_BRUSH_DEFAULT_STARTUP_BRUSH_SIZE_RANGE,
      ),
    ).toBeCloseTo(0.1125);
    expect(OPEN_BRUSH_DEFAULT_STARTUP_SCREENSHOT_BRUSH_SIZE).toBeCloseTo(
      0.1125,
    );
    // Light at the default slider is a ~1.1cm-wide stroke, as in Open Brush.
    expect(OPEN_BRUSH_DEFAULT_STARTUP_LIVE_BRUSH_SIZE).toBeCloseTo(0.01125, 6);
    expect(
      brushSize01ToLiveBrushSize(
        OPEN_BRUSH_DEFAULT_SIZE01,
        OPEN_BRUSH_DEFAULT_STARTUP_BRUSH_SIZE_RANGE,
      ),
    ).toBeCloseTo(OPEN_BRUSH_DEFAULT_STARTUP_LIVE_BRUSH_SIZE);
  });

  it("rejects invalid live brush sizes", () => {
    expect(normalizeBrushSize(Number.NaN)).toBe(
      OPEN_BRUSH_DEFAULT_STARTUP_LIVE_BRUSH_SIZE,
    );
    expect(normalizeBrushSize(0)).toBe(
      OPEN_BRUSH_DEFAULT_STARTUP_LIVE_BRUSH_SIZE,
    );
    expect(normalizeBrushSize(0.025)).toBe(0.025);
  });

  it("clamps normalized brush size controls", () => {
    expect(normalizeBrushSize01(Number.NaN)).toBe(OPEN_BRUSH_DEFAULT_SIZE01);
    expect(normalizeBrushSize01(-1)).toBe(0);
    expect(normalizeBrushSize01(2)).toBe(1);
    expect(normalizeBrushSize01(0.25)).toBe(0.25);
  });

  it("normalizes invalid or reversed brush ranges", () => {
    expect(normalizeBrushSizeRange(undefined)).toEqual(
      OPEN_BRUSH_DEFAULT_BRUSH_SIZE_RANGE,
    );
    expect(normalizeBrushSizeRange([0, 2])).toEqual(
      OPEN_BRUSH_DEFAULT_BRUSH_SIZE_RANGE,
    );
    expect(normalizeBrushSizeRange([2, 0.25])).toEqual([0.25, 2]);
  });

  it("matches Open Brush sqrt-radius size interpolation", () => {
    expect(brushSize01ToOpenBrushSize(0, [0.05, 3])).toBeCloseTo(0.05);
    expect(brushSize01ToOpenBrushSize(1, [0.05, 3])).toBeCloseTo(3);
    expect(brushSize01ToOpenBrushSize(0.5, [0.05, 3])).toBeCloseTo(
      0.9561862178478972,
    );
    expect(openBrushSizeToBrushSize01(0.9561862178478972, [0.05, 3])).toBeCloseTo(
      0.5,
    );
  });

  it("round trips IWSDK live sizes through the active brush range", () => {
    const lightRange = [0.05, 0.2] as const;
    const liveSize = brushSize01ToLiveBrushSize(0.65, lightRange);

    expect(liveSize).toBeGreaterThan(0);
    expect(liveBrushSizeToSize01(liveSize, lightRange)).toBeCloseTo(0.65);
  });

  it("preserves absolute size across brush switches like Open Brush", () => {
    const lightRange = [0.05, 0.2] as const;
    const markerRange = [0.05, 3] as const;

    // Light default (~1.1cm) carried into Marker stays ~1.1cm.
    const lightSize = brushSize01ToLiveBrushSize(0.5, lightRange);
    const ontoMarker = resolveBrushSizeForBrushChange(lightSize, markerRange);
    expect(ontoMarker.size).toBeCloseTo(lightSize);
    expect(ontoMarker.size01).toBeLessThan(0.15);

    // A huge Marker stroke clamps down to Light's maximum on the way back.
    const bigMarker = brushSize01ToLiveBrushSize(1, markerRange);
    const backToLight = resolveBrushSizeForBrushChange(bigMarker, lightRange);
    expect(backToLight.size).toBeCloseTo(0.2 * 0.1);
    expect(backToLight.size01).toBe(1);
  });

  it("resolves normalized UI size nudges into live brush sizes", () => {
    const lightRange = [0.05, 0.2] as const;
    const increased = resolveBrushSize01Adjustment(0.5, 0.05, lightRange);
    const clampedLow = resolveBrushSize01Adjustment(0.01, -0.1, lightRange);
    const clampedHigh = resolveBrushSize01Adjustment(0.98, 0.1, lightRange);

    expect(increased.size01).toBeCloseTo(0.55);
    expect(increased.size).toBeCloseTo(
      brushSize01ToLiveBrushSize(0.55, lightRange),
    );
    expect(clampedLow.size01).toBe(0);
    expect(clampedHigh.size01).toBe(1);
  });

  it("maps brush-hand thumbstick left and right to continuous size changes", () => {
    const lightRange = [0.05, 0.2] as const;

    expect(normalizeBrushSizeThumbstickAxis(0.1)).toBe(0);
    expect(normalizeBrushSizeThumbstickAxis(-1)).toBe(-1);
    expect(normalizeBrushSizeThumbstickAxis(1)).toBe(1);

    const shrunk = resolveBrushSizeThumbstickAdjustment(0.5, -1, 0.5, lightRange);
    const grown = resolveBrushSizeThumbstickAdjustment(0.5, 1, 0.5, lightRange);

    expect(shrunk.size01).toBeLessThan(0.5);
    expect(grown.size01).toBeGreaterThan(0.5);
    expect(shrunk.size).toBeCloseTo(
      brushSize01ToLiveBrushSize(shrunk.size01, lightRange),
    );
    expect(grown.size).toBeCloseTo(
      brushSize01ToLiveBrushSize(grown.size01, lightRange),
    );
  });
});
