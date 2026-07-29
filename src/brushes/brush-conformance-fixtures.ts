import {
  StrokeFlags,
  createEmptyStrokeData,
  type ControlPoint,
  type Quat,
  type StrokeData,
  type Vec3,
} from "../types.js";

export type BrushConformanceFixtureName =
  | "line"
  | "arc"
  | "helix"
  | "sharp-corner"
  | "reversal"
  | "pressure-ramp"
  | "twist"
  | "dot"
  | "long-stroke"
  | "segment-break";

export interface BrushConformanceFixture {
  name: BrushConformanceFixtureName;
  strokes: StrokeData[];
}

const FIXTURE_BRUSH_GUID = "429ed64a-4e97-4466-84d3-145a861ef684";
const POINT_INTERVAL_MS = 10;
export const OPEN_BRUSH_SCREENSHOT_SHADER_TIME_SECONDS = 0.5;
const FIXTURE_STROKE_GUIDS: Readonly<Record<string, string>> = {
  line: "c0ffee00-0000-4000-8000-000000000001",
  arc: "c0ffee00-0000-4000-8000-000000000002",
  helix: "c0ffee00-0000-4000-8000-000000000003",
  "sharp-corner": "c0ffee00-0000-4000-8000-000000000004",
  reversal: "c0ffee00-0000-4000-8000-000000000005",
  "pressure-ramp": "c0ffee00-0000-4000-8000-000000000006",
  twist: "c0ffee00-0000-4000-8000-000000000007",
  dot: "c0ffee00-0000-4000-8000-000000000008",
  "long-stroke": "c0ffee00-0000-4000-8000-000000000009",
  "segment-break-a": "c0ffee00-0000-4000-8000-00000000000a",
  "segment-break-b": "c0ffee00-0000-4000-8000-00000000000b",
};

/** Deterministic inputs shared by mesh dumps and fixed-camera render tests. */
export function createBrushConformanceFixtures(): BrushConformanceFixture[] {
  return [
    fixture("line", [makeStroke("line", sample(17, (t) => [t * 2 - 1, 0, 0]))]),
    fixture("arc", [
      makeStroke("arc", sample(25, (t) => [Math.cos(Math.PI * t), Math.sin(Math.PI * t), 0])),
    ]),
    fixture("helix", [
      makeStroke(
        "helix",
        sample(49, (t) => [Math.cos(Math.PI * 4 * t), t * 2 - 1, Math.sin(Math.PI * 4 * t)]),
      ),
    ]),
    fixture("sharp-corner", [
      makeStroke("sharp-corner", [
        point([-1, 0, 0], 0),
        point([-0.5, 0, 0], 1),
        point([0, 0, 0], 2),
        point([0, 0.5, 0], 3),
        point([0, 1, 0], 4),
      ]),
    ]),
    fixture("reversal", [
      makeStroke("reversal", [
        point([-1, 0, 0], 0),
        point([-0.5, 0, 0], 1),
        point([0, 0, 0], 2),
        point([-0.5, 0, 0], 3),
        point([-1, 0, 0], 4),
      ]),
    ]),
    fixture("pressure-ramp", [
      makeStroke(
        "pressure-ramp",
        sample(17, (t) => [t * 2 - 1, 0, 0], (t) => t),
      ),
    ]),
    fixture("twist", [
      makeStroke(
        "twist",
        sample(17, (t) => [t * 2 - 1, 0, 0], undefined, (t) =>
          axisAngle([1, 0, 0], Math.PI * 2 * t),
        ),
      ),
    ]),
    fixture("dot", [makeStroke("dot", [point([0, 0, 0], 0)])]),
    fixture("long-stroke", [
      makeStroke(
        "long-stroke",
        sample(257, (t) => [t * 20 - 10, Math.sin(t * Math.PI * 8) * 0.2, 0]),
      ),
    ]),
    fixture("segment-break", [
      makeStroke("segment-break-a", sample(9, (t) => [t - 1, 0, 0]), {
        groupId: 7,
      }),
      makeStroke("segment-break-b", sample(9, (t) => [t, 0.5, 0]), {
        groupId: 7,
        flags: StrokeFlags.IsGroupContinue,
      }),
    ]),
  ];
}

/**
 * Matches the stroke drawn by Open Brush's brush screenshot generator.
 * Open Brush's float32 loop creates 31 path transforms (the accumulated value
 * before the final increment is 2.9999993). DrawStrokes intentionally omits
 * the final transform when converting that path to control points.
 */
export function createOpenBrushScreenshotControlPoints(): ControlPoint[] {
  const path: number[] = [];
  for (let x = Math.fround(0); x < 3; x = Math.fround(x + Math.fround(0.1))) {
    path.push(x);
  }
  return path.slice(0, -1).map((x, index) => {
    return point(
      [-1.25 + x, Math.sin(x * 5) * (1 - x / 3), -4],
      index,
    );
  });
}

function fixture(
  name: BrushConformanceFixtureName,
  strokes: StrokeData[],
): BrushConformanceFixture {
  return { name, strokes };
}

function makeStroke(
  id: string,
  controlPoints: ControlPoint[],
  overrides: Partial<StrokeData> = {},
): StrokeData {
  const guid = FIXTURE_STROKE_GUIDS[id];
  if (!guid) {
    throw new Error(`Missing deterministic conformance GUID for ${id}.`);
  }
  return createEmptyStrokeData({
    brushGuid: FIXTURE_BRUSH_GUID,
    brushSize: 0.1,
    brushScale: 1,
    color: [0.25, 0.5, 0.75, 1],
    controlPoints,
    seed: 0x5eed,
    guid,
    ...overrides,
  });
}

function sample(
  count: number,
  positionAt: (t: number) => Vec3,
  pressureAt: (t: number) => number = () => 1,
  orientationAt: (t: number) => Quat = () => [0, 0, 0, 1],
): ControlPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1);
    return point(positionAt(t), index, pressureAt(t), orientationAt(t));
  });
}

function point(
  position: Vec3,
  index: number,
  pressure = 1,
  orientation: Quat = [0, 0, 0, 1],
): ControlPoint {
  return {
    position,
    orientation,
    pressure,
    timestampMs: index * POINT_INTERVAL_MS,
  };
}

function axisAngle(axis: Vec3, angle: number): Quat {
  const halfAngle = angle * 0.5;
  const scale = Math.sin(halfAngle);
  return [axis[0] * scale, axis[1] * scale, axis[2] * scale, Math.cos(halfAngle)];
}
