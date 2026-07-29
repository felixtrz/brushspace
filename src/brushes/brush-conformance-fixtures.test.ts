import { describe, expect, it } from "vitest";

import { StrokeFlags } from "../types.js";
import {
  createBrushConformanceFixtures,
  createOpenBrushScreenshotControlPoints,
  OPEN_BRUSH_SCREENSHOT_SHADER_TIME_SECONDS,
} from "./brush-conformance-fixtures.js";

describe("brush conformance fixtures", () => {
  it("covers every required deterministic stroke case", () => {
    const fixtures = createBrushConformanceFixtures();
    expect(fixtures.map(({ name }) => name)).toEqual([
      "line",
      "arc",
      "helix",
      "sharp-corner",
      "reversal",
      "pressure-ramp",
      "twist",
      "dot",
      "long-stroke",
      "segment-break",
    ]);
    expect(new Set(fixtures.map(({ name }) => name)).size).toBe(fixtures.length);
  });

  it("is byte-for-byte deterministic as data", () => {
    expect(createBrushConformanceFixtures()).toEqual(
      createBrushConformanceFixtures(),
    );
  });

  it("contains the intended pressure and orientation extremes", () => {
    const fixtures = createBrushConformanceFixtures();
    const pressure = fixtures.find(({ name }) => name === "pressure-ramp")!;
    expect(pressure.strokes[0].controlPoints[0].pressure).toBe(0);
    expect(
      pressure.strokes[0].controlPoints[
        pressure.strokes[0].controlPoints.length - 1
      ].pressure,
    ).toBe(1);

    const twist = fixtures.find(({ name }) => name === "twist")!;
    expect(twist.strokes[0].controlPoints[0].orientation).toEqual([0, 0, 0, 1]);
    expect(
      twist.strokes[0].controlPoints[twist.strokes[0].controlPoints.length - 1]
        .orientation[3],
    ).toBeCloseTo(-1);
  });

  it("represents a segment break as grouped, disconnected strokes", () => {
    const fixture = createBrushConformanceFixtures().find(
      ({ name }) => name === "segment-break",
    )!;
    expect(fixture.strokes).toHaveLength(2);
    expect(fixture.strokes[0].groupId).toBe(fixture.strokes[1].groupId);
    expect(fixture.strokes[0].flags).toBe(StrokeFlags.None);
    expect(fixture.strokes[1].flags).toBe(StrokeFlags.IsGroupContinue);
    expect(fixture.strokes[0].guid).not.toBe(fixture.strokes[1].guid);
  });

  it("matches the Open Brush brush-screenshot stroke fixture", () => {
    const points = createOpenBrushScreenshotControlPoints();
    expect(points).toHaveLength(30);
    expect(points[0]).toEqual({
      position: [-1.25, 0, -4],
      orientation: [0, 0, 0, 1],
      pressure: 1,
      timestampMs: 0,
    });
    expect(points[29].position[0]).toBeCloseTo(1.6499994);
    expect(points[29].position[1]).toBeCloseTo(
      Math.sin(2.8999994 * 5) * (1 - 2.8999994 / 3),
    );
    expect(OPEN_BRUSH_SCREENSHOT_SHADER_TIME_SECONDS).toBe(0.5);
  });
});
