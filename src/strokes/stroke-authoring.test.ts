import { describe, expect, it } from "vitest";

import {
  advanceStrokeAuthoringState,
  createMirroredStrokeDataX,
  createStrokeAuthoringState,
  shouldSampleControlPoint,
  STRAIGHTEDGE_LINE_CONTROL_POINT_COUNT,
  upsertStraightedgeEndpoint,
  upsertTapeMeasureEndpoints,
  writeGridSnappedPosition,
  writeLazyInputPosition,
  writeStencilPlaneProjectedPosition,
  type StrokePointerFrame,
  resolveStrokeSampleDecision,
  resolveStrokeSpawnIntervalMeters,
  resolveDistanceSmoothedPressure,
  resolveGeneratorSolidMinLengthMeters,
  shouldSmoothStrokeSamplingPressure,
  shouldDiscardGeneratedStroke,
  shouldZeroInitialM11SamplingPressure,
  OPEN_BRUSH_M11_PRESSURE_SMOOTH_WINDOW_METERS,
  OPEN_BRUSH_RIBBON_SOLID_MIN_LENGTH_METERS,
} from "./stroke-authoring.js";
import { StrokeFlags, createEmptyStrokeData, type ControlPoint } from "../types.js";

function frame(paintPressed: boolean, x: number): StrokePointerFrame {
  return {
    paintPressed,
    pressure: paintPressed ? 1 : 0,
    position: [x, 0, 0],
    orientation: [0, 0, 0, 1],
    timestampMs: x * 1000,
  };
}

function pressuredFrame(x: number, pressure: number): StrokePointerFrame {
  return {
    paintPressed: pressure > 0,
    pressure,
    position: [x, 0, 0],
    orientation: [0, 0, 0, 1],
    timestampMs: x * 1000,
  };
}

describe("stroke authoring state", () => {
  it("starts exactly one stroke when paint becomes pressed", () => {
    const state = createStrokeAuthoringState();

    expect(advanceStrokeAuthoringState(state, frame(false, 0))).toBe("none");
    expect(advanceStrokeAuthoringState(state, frame(true, 0))).toBe("start");
    expect(advanceStrokeAuthoringState(state, frame(true, 0.1))).toBe("sample");

    expect(state.phase).toBe("drawing");
    expect(state.controlPointCount).toBe(2);
    expect(state.finalizedStrokeCount).toBe(0);
  });

  it("finalizes the active stroke when paint is released", () => {
    const state = createStrokeAuthoringState();

    advanceStrokeAuthoringState(state, frame(true, 0));
    advanceStrokeAuthoringState(state, frame(true, 0.1));

    expect(advanceStrokeAuthoringState(state, frame(false, 0.2))).toBe(
      "finalize",
    );
    expect(state.phase).toBe("idle");
    expect(state.finalizedStrokeCount).toBe(1);
  });

  it("uses squared distance to gate control point sampling", () => {
    expect(shouldSampleControlPoint([0, 0, 0], [0.01, 0, 0], 0.02)).toBe(
      false,
    );
    expect(shouldSampleControlPoint([0, 0, 0], [0.02, 0, 0], 0.02)).toBe(true);
    expect(shouldSampleControlPoint([0, 0, 0], [0.015, 0.015, 0], 0.02)).toBe(
      true,
    );
  });

  it("snaps positions to a fixed grid without allocating a result vector", () => {
    const target: [number, number, number] = [0, 0, 0];
    const source: [number, number, number] = [0.134, 1.249, -0.151];

    writeGridSnappedPosition(target, source, 0.1);

    expect(target).toEqual([0.1, 1.2000000000000002, -0.2]);
    expect(source).toEqual([0.134, 1.249, -0.151]);
  });

  it("copies positions unchanged when grid size is disabled", () => {
    const target: [number, number, number] = [0, 0, 0];
    const source: [number, number, number] = [0.134, 1.249, -0.151];

    writeGridSnappedPosition(target, source, 0);

    expect(target).toEqual(source);
    expect(target).not.toBe(source);
  });

  it("keeps lazy input anchored until the pointer leaves the radius", () => {
    const target: [number, number, number] = [0, 0, 0];
    const anchor: [number, number, number] = [1, 2, 3];

    writeLazyInputPosition(target, anchor, [1.03, 2, 3], 0.05);

    expect(target).toEqual(anchor);
  });

  it("moves lazy input toward the pointer while preserving the leash radius", () => {
    const target: [number, number, number] = [0, 0, 0];

    writeLazyInputPosition(target, [0, 0, 0], [0.2, 0, 0], 0.05);

    expect(target).toEqual([0.15000000000000002, 0, 0]);
  });

  it("projects stencil samples onto a fixed plane without mutating the source", () => {
    const target: [number, number, number] = [0, 0, 0];
    const source: [number, number, number] = [0.4, 1.1, -0.7];

    writeStencilPlaneProjectedPosition(target, source, "z", -1.2);

    expect(target).toEqual([0.4, 1.1, -1.2]);
    expect(source).toEqual([0.4, 1.1, -0.7]);
  });

  it("supports in-place stencil projection", () => {
    const target: [number, number, number] = [0.4, 1.1, -0.7];

    writeStencilPlaneProjectedPosition(target, target, "x", 0.25);

    expect(target).toEqual([0.25, 1.1, -0.7]);
  });

  it("writes straightedge lines as upstream-style parametric samples", () => {
    const controlPoints: ControlPoint[] = [];

    expect(upsertStraightedgeEndpoint(controlPoints, frame(true, 0), 0.02)).toBe(
      "created",
    );
    expect(controlPoints).toHaveLength(1);
    expect(
      upsertStraightedgeEndpoint(controlPoints, frame(true, 0.01), 0.02),
    ).toBe("ignored");
    expect(controlPoints).toHaveLength(1);

    expect(upsertStraightedgeEndpoint(controlPoints, frame(true, 0.1), 0.02)).toBe(
      "created",
    );
    expect(controlPoints).toHaveLength(STRAIGHTEDGE_LINE_CONTROL_POINT_COUNT);
    expect(controlPoints[0].position).toEqual([0, 0, 0]);
    expect(controlPoints[15].position).toEqual([0.05, 0, 0]);
    expect(controlPoints[30].position).toEqual([0.1, 0, 0]);
    expect(controlPoints.map((point) => point.pressure)).toEqual(
      Array.from({ length: STRAIGHTEDGE_LINE_CONTROL_POINT_COUNT }, () => 1),
    );

    const midpoint = controlPoints[15];
    const endpoint = controlPoints[30];
    expect(upsertStraightedgeEndpoint(controlPoints, frame(true, 0.3), 0.02)).toBe(
      "updated",
    );
    expect(controlPoints).toHaveLength(STRAIGHTEDGE_LINE_CONTROL_POINT_COUNT);
    expect(controlPoints[15]).toBe(midpoint);
    expect(controlPoints[30]).toBe(endpoint);
    expect(controlPoints[15].position).toEqual([0.15, 0, 0]);
    expect(controlPoints[30].position).toEqual([0.3, 0, 0]);
  });

  it("forces straightedge pressure to the upstream constant", () => {
    const controlPoints: ControlPoint[] = [];

    expect(
      upsertStraightedgeEndpoint(controlPoints, pressuredFrame(0, 0.2), 0.02),
    ).toBe("created");
    expect(controlPoints[0].pressure).toBe(1);

    expect(
      upsertStraightedgeEndpoint(controlPoints, pressuredFrame(0.1, 0.2), 0.02),
    ).toBe("created");
    expect(controlPoints).toHaveLength(STRAIGHTEDGE_LINE_CONTROL_POINT_COUNT);
    expect(controlPoints.every((point) => point.pressure === 1)).toBe(true);
  });

  it("keeps tape measure strokes to bimanual anchor and endpoint pairs", () => {
    const controlPoints: ControlPoint[] = [];

    expect(
      upsertTapeMeasureEndpoints(
        controlPoints,
        frame(true, 0),
        frame(true, 0.01),
        0.02,
      ),
    ).toBe("ignored");
    expect(controlPoints).toHaveLength(0);

    expect(
      upsertTapeMeasureEndpoints(
        controlPoints,
        frame(true, -0.2),
        frame(true, 0.2),
        0.02,
      ),
    ).toBe("created");
    expect(controlPoints).toHaveLength(2);
    expect(controlPoints[0].position).toEqual([-0.2, 0, 0]);
    expect(controlPoints[1].position).toEqual([0.2, 0, 0]);

    const anchor = controlPoints[0];
    const endpoint = controlPoints[1];
    expect(
      upsertTapeMeasureEndpoints(
        controlPoints,
        frame(true, -0.4),
        frame(true, 0.1),
        0.02,
      ),
    ).toBe("updated");
    expect(controlPoints).toHaveLength(2);
    expect(controlPoints[0]).toBe(anchor);
    expect(controlPoints[1]).toBe(endpoint);
    expect(controlPoints[0].position).toEqual([-0.4, 0, 0]);
    expect(controlPoints[1].position).toEqual([0.1, 0, 0]);
  });

  it("mirrors stroke data across the X axis with group continuation metadata", () => {
    const source = createEmptyStrokeData({
      guid: "source",
      seed: 12,
      groupId: 7,
      color: [0.2, 0.4, 0.6, 1],
      controlPoints: [
        {
          position: [0.25, 1, -0.5],
          orientation: [0, 0, 0, 1],
          pressure: 0.5,
          timestampMs: 100,
        },
        {
          position: [-0.75, 2, -0.25],
          orientation: [0, 0.5, 0, 0.5],
          pressure: 1,
          timestampMs: 200,
        },
      ],
    });

    const mirrored = createMirroredStrokeDataX(source, {
      guid: "mirror",
      seed: 13,
    });

    expect(mirrored.guid).toBe("mirror");
    expect(mirrored.seed).toBe(13);
    expect(mirrored.groupId).toBe(7);
    expect(mirrored.flags & StrokeFlags.IsGroupContinue).toBe(
      StrokeFlags.IsGroupContinue,
    );
    expect(mirrored.color).toEqual(source.color);
    expect(mirrored.color).not.toBe(source.color);
    expect(mirrored.controlPoints).toHaveLength(2);
    expect(mirrored.controlPoints[0].position).toEqual([-0.25, 1, -0.5]);
    expect(mirrored.controlPoints[1].position).toEqual([0.75, 2, -0.25]);
  });
});

describe("Open Brush stroke sampling", () => {
  it("discards finalized strokes with no generated triangles", () => {
    expect(shouldDiscardGeneratedStroke(0)).toBe(true);
    expect(shouldDiscardGeneratedStroke(Number.NaN)).toBe(true);
    expect(shouldDiscardGeneratedStroke(6)).toBe(false);
  });

  it("computes the spawn interval from solid min length and pressured size", () => {
    // Light at its default size (1.125cm), full pressure:
    // 0.0015 + 0.01125 * 0.2 = 3.75mm between keeper points.
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 0.01125,
        pressure: 1,
        pressureSizeMin: 0.15,
        solidMinLengthMeters: OPEN_BRUSH_RIBBON_SOLID_MIN_LENGTH_METERS,
      }),
    ).toBeCloseTo(0.00375, 6);

    // Light pressure shrinks the pressured size and tightens the interval.
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 0.01125,
        pressure: 0,
        pressureSizeMin: 0.15,
        solidMinLengthMeters: OPEN_BRUSH_RIBBON_SOLID_MIN_LENGTH_METERS,
      }),
    ).toBeCloseTo(0.0015 + 0.01125 * 0.15 * 0.2, 6);
  });

  it("selects solid minimum length by generator rather than broad family", () => {
    expect(
      resolveGeneratorSolidMinLengthMeters({
        generatorClass: "QuadStripBrushDistanceUV",
        descriptorValue: 0.002,
        geometryFamily: "ribbon",
      }),
    ).toBe(0.0015);
    expect(
      resolveGeneratorSolidMinLengthMeters({
        generatorClass: "FlatGeometryBrush",
        descriptorValue: 0.002,
        geometryFamily: "ribbon",
      }),
    ).toBe(0.002);
    expect(
      resolveGeneratorSolidMinLengthMeters({
        generatorClass: "ThickGeometryBrush",
        geometryFamily: "thick-strip",
      }),
    ).toBe(0.002);
    expect(
      resolveGeneratorSolidMinLengthMeters({
        generatorClass: "HullBrush",
        descriptorValue: 0.003,
        geometryFamily: "hull",
      }),
    ).toBe(0.003);
  });

  it("uses generator-specific particle, print, and hull spawn intervals", () => {
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 0.2,
        pressure: 0.5,
        pressureSizeMin: 0,
        generatorClass: "SprayBrush",
        sprayRateMultiplier: 4,
      }),
    ).toBeCloseTo(0.025, 6);
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 1,
        pressure: 1,
        generatorClass: "GeniusParticlesBrush",
        particleRate: 2,
        localUnitsPerMeter: 0.5,
      }),
    ).toBeCloseTo(0.000625, 6);
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 1,
        pressure: 1,
        generatorClass: "Square3DPrintBrush",
        localUnitsPerMeter: 1,
      }),
    ).toBeCloseTo(0.005, 6);
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 1,
        pressure: 1,
        generatorClass: "Square3DPrintBrush",
        localUnitsPerMeter: 10,
      }),
    ).toBeCloseTo(0.01, 6);
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 1,
        pressure: 1,
        generatorClass: "Square3DPrintBrush",
        localUnitsPerMeter: 0.05,
      }),
    ).toBeCloseTo(0.0025, 6);
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 1,
        pressure: 1,
        solidMinLengthMeters: 0.003,
        generatorClass: "HullBrush",
      }),
    ).toBeCloseTo(0.003, 6);
    expect(
      resolveStrokeSpawnIntervalMeters({
        brushSize: 1,
        pressure: 1,
        solidMinLengthMeters: 0.004,
        generatorClass: "ConcaveHullBrush",
      }),
    ).toBeCloseTo(0.004, 6);
  });

  it("smooths keeper pressure over Open Brush's distance window", () => {
    expect(
      resolveDistanceSmoothedPressure({
        previousPressure: 0,
        pressure: 1,
        distanceMeters: 0.1,
      }),
    ).toBeCloseTo(1 - Math.pow(0.1, 0.5), 6);
    expect(
      resolveDistanceSmoothedPressure({
        previousPressure: 0,
        pressure: 1,
        distanceMeters: 0.1,
        windowMeters: OPEN_BRUSH_M11_PRESSURE_SMOOTH_WINDOW_METERS,
      }),
    ).toBeCloseTo(0.9, 6);
  });

  it("preserves raw pressure for particle generators that disable smoothing", () => {
    expect(shouldSmoothStrokeSamplingPressure("TubeBrush")).toBe(true);
    expect(shouldSmoothStrokeSamplingPressure("QuadStripBrushDistanceUV")).toBe(
      true,
    );
    expect(shouldSmoothStrokeSamplingPressure("SprayBrush")).toBe(false);
    expect(
      shouldSmoothStrokeSamplingPressure("MidpointPlusLifetimeSprayBrush"),
    ).toBe(true);
    expect(shouldSmoothStrokeSamplingPressure("GeniusParticlesBrush")).toBe(
      false,
    );
  });

  it("limits M11 zero initial pressure to GeometryBrush generator paths", () => {
    expect(shouldZeroInitialM11SamplingPressure("FlatGeometryBrush")).toBe(true);
    expect(shouldZeroInitialM11SamplingPressure("TubeBrush")).toBe(true);
    expect(shouldZeroInitialM11SamplingPressure("ThickGeometryBrush")).toBe(
      true,
    );
    expect(
      shouldZeroInitialM11SamplingPressure("QuadStripBrushDistanceUV"),
    ).toBe(false);
    expect(shouldZeroInitialM11SamplingPressure("SprayBrush")).toBe(false);
    expect(shouldZeroInitialM11SamplingPressure("GeniusParticlesBrush")).toBe(
      false,
    );
  });

  it("ignores sub-half-millimeter movement from the last keeper", () => {
    expect(
      resolveStrokeSampleDecision([0, 0, 0], [0.0004, 0, 0], 0.00375),
    ).toBe("ignore");
  });

  it("extends the trailing point below the spawn interval", () => {
    expect(
      resolveStrokeSampleDecision([0, 0, 0], [0.002, 0, 0], 0.00375),
    ).toBe("extend");
  });

  it("keeps a new control point past the spawn interval", () => {
    expect(
      resolveStrokeSampleDecision([0, 0, 0], [0.004, 0, 0], 0.00375),
    ).toBe("keep");
  });

  it("uses the pressured Spray interval for preview keeper sampling", () => {
    const spawnInterval = resolveStrokeSpawnIntervalMeters({
      brushSize: 0.02,
      pressure: 1,
      pressureSizeMin: 0.25,
      generatorClass: "SprayBrush",
      sprayRateMultiplier: 4,
    });

    expect(spawnInterval).toBeCloseTo(0.005);
    expect(
      resolveStrokeSampleDecision([0, 0, 0], [0.004, 0, 0], spawnInterval),
    ).toBe("extend");
    expect(
      resolveStrokeSampleDecision([0, 0, 0], [0.006, 0, 0], spawnInterval),
    ).toBe("keep");
  });
});
