import {
  StrokeFlags,
  type ControlPoint,
  type Quat,
  type StrokeData,
  type Vec3,
} from "../types.js";

export type StrokeAuthoringPhase = "idle" | "drawing";
export type StrokeAuthoringEvent = "none" | "start" | "sample" | "finalize";
const STRAIGHTEDGE_PRESSURE = 1;

export interface StrokeAuthoringState {
  phase: StrokeAuthoringPhase;
  controlPointCount: number;
  finalizedStrokeCount: number;
}

export interface StrokePointerFrame {
  paintPressed: boolean;
  pressure: number;
  position: Vec3;
  orientation: Quat;
  timestampMs: number;
}

export function createStrokeAuthoringState(): StrokeAuthoringState {
  return {
    phase: "idle",
    controlPointCount: 0,
    finalizedStrokeCount: 0,
  };
}

export function advanceStrokeAuthoringState(
  state: StrokeAuthoringState,
  frame: StrokePointerFrame,
): StrokeAuthoringEvent {
  if (state.phase === "idle") {
    if (!frame.paintPressed) {
      return "none";
    }
    state.phase = "drawing";
    state.controlPointCount = 1;
    return "start";
  }

  if (!frame.paintPressed) {
    state.phase = "idle";
    state.finalizedStrokeCount += 1;
    return "finalize";
  }

  state.controlPointCount += 1;
  return "sample";
}

export function shouldSampleControlPoint(
  previousPosition: Vec3,
  nextPosition: Vec3,
  minDistance: number,
): boolean {
  const dx = nextPosition[0] - previousPosition[0];
  const dy = nextPosition[1] - previousPosition[1];
  const dz = nextPosition[2] - previousPosition[2];
  return dx * dx + dy * dy + dz * dz >= minDistance * minDistance;
}

// Open Brush stroke sampling (QuadStripBrush/TubeBrush + PointerScript):
// geometry ignores movement under kMinimumMoveLengthMeters_PS; a new solid
// segment ("keeper" control point) spawns once the pointer travels
// solidMinLength + pressuredSize * kSolidAspectRatio from the last keeper.
// Between keepers the trailing control point is overwritten every frame so
// the stroke tip stays glued to the pointer.
export const OPEN_BRUSH_MINIMUM_MOVE_METERS = 5e-4;
export const OPEN_BRUSH_SOLID_ASPECT_RATIO = 0.2;
export const OPEN_BRUSH_RIBBON_SOLID_MIN_LENGTH_METERS = 0.0015;
export const OPEN_BRUSH_TUBE_DEFAULT_SOLID_MIN_LENGTH_METERS = 0.002;
export const OPEN_BRUSH_PRESSURE_SMOOTH_WINDOW_METERS = 0.2;
export const OPEN_BRUSH_M11_PRESSURE_SMOOTH_WINDOW_METERS = 0.1;
export const OPEN_BRUSH_GENIUS_PARTICLE_INTERVAL_METERS = 0.0025;
export const OPEN_BRUSH_PRINT3D_RING_INTERVAL_METERS = 0.005;
export const OPEN_BRUSH_PRINT3D_MIN_POINTER_INTERVAL_METERS = 0.001;
export const OPEN_BRUSH_PRINT3D_MAX_POINTER_INTERVAL_METERS = 0.05;

export type StrokeSampleDecision = "ignore" | "extend" | "keep";

export function shouldDiscardGeneratedStroke(indexCount: number): boolean {
  return !Number.isFinite(indexCount) || indexCount <= 0;
}

export function resolveGeneratorSolidMinLengthMeters(options: {
  generatorClass?: string;
  descriptorValue?: number;
  geometryFamily?: string;
}): number {
  if (options.generatorClass?.startsWith("QuadStrip") === true) {
    return OPEN_BRUSH_RIBBON_SOLID_MIN_LENGTH_METERS;
  }
  if (
    typeof options.descriptorValue === "number" &&
    Number.isFinite(options.descriptorValue) &&
    options.descriptorValue > 0
  ) {
    return options.descriptorValue;
  }
  if (options.generatorClass) {
    return OPEN_BRUSH_TUBE_DEFAULT_SOLID_MIN_LENGTH_METERS;
  }
  return options.geometryFamily === "ribbon" ||
    options.geometryFamily === "emissive"
    ? OPEN_BRUSH_RIBBON_SOLID_MIN_LENGTH_METERS
    : OPEN_BRUSH_TUBE_DEFAULT_SOLID_MIN_LENGTH_METERS;
}

export function shouldSmoothStrokeSamplingPressure(
  generatorClass: string | undefined,
): boolean {
  return (
    generatorClass !== "SprayBrush" &&
    generatorClass !== "GeniusParticlesBrush"
  );
}

export function shouldZeroInitialM11SamplingPressure(
  generatorClass: string | undefined,
): boolean {
  return (
    generatorClass === "FlatGeometryBrush" ||
    generatorClass === "TubeBrush" ||
    generatorClass === "SquareBrush" ||
    generatorClass === "ThickGeometryBrush" ||
    generatorClass === "PrintableBrush" ||
    generatorClass === "Square3DPrintBrush" ||
    generatorClass === "HullBrush" ||
    generatorClass === "ConcaveHullBrush"
  );
}

export function resolveDistanceSmoothedPressure(options: {
  previousPressure: number;
  pressure: number;
  distanceMeters: number;
  windowMeters?: number;
}): number {
  const previousPressure = Math.min(1, Math.max(0, options.previousPressure));
  const pressure = Math.min(1, Math.max(0, options.pressure));
  const distanceMeters = Math.max(0, options.distanceMeters);
  const windowMeters =
    typeof options.windowMeters === "number" &&
    Number.isFinite(options.windowMeters) &&
    options.windowMeters > 0
      ? options.windowMeters
      : OPEN_BRUSH_PRESSURE_SMOOTH_WINDOW_METERS;
  const retained = Math.pow(0.1, distanceMeters / windowMeters);
  return retained * previousPressure + (1 - retained) * pressure;
}

export function resolveStrokeSpawnIntervalMeters(options: {
  brushSize: number;
  pressure: number;
  pressureSizeMin?: number;
  solidMinLengthMeters?: number;
  generatorClass?: string;
  sprayRateMultiplier?: number;
  particleRate?: number;
  localUnitsPerMeter?: number;
}): number {
  const pressure = Math.min(1, Math.max(0, options.pressure));
  const pressureSizeMin =
    typeof options.pressureSizeMin === "number" &&
    Number.isFinite(options.pressureSizeMin)
      ? Math.min(1, Math.max(0, options.pressureSizeMin))
      : 1;
  const solidMinLength =
    typeof options.solidMinLengthMeters === "number" &&
    Number.isFinite(options.solidMinLengthMeters) &&
    options.solidMinLengthMeters > 0
      ? options.solidMinLengthMeters
      : OPEN_BRUSH_RIBBON_SOLID_MIN_LENGTH_METERS;
  const pressuredSize =
    Math.max(0, options.brushSize) *
    (pressureSizeMin + (1 - pressureSizeMin) * pressure);
  if (
    options.generatorClass === "SprayBrush" ||
    options.generatorClass === "MidpointPlusLifetimeSprayBrush"
  ) {
    const sprayRate = normalizePositiveSamplingValue(
      options.sprayRateMultiplier,
    );
    return pressuredSize / sprayRate;
  }
  if (options.generatorClass === "GeniusParticlesBrush") {
    const particleRate = normalizePositiveSamplingValue(options.particleRate);
    const localUnitsPerMeter = normalizePositiveSamplingValue(
      options.localUnitsPerMeter,
    );
    return (
      (OPEN_BRUSH_GENIUS_PARTICLE_INTERVAL_METERS * localUnitsPerMeter) /
      particleRate
    );
  }
  if (options.generatorClass === "Square3DPrintBrush") {
    const localUnitsPerMeter = normalizePositiveSamplingValue(
      options.localUnitsPerMeter,
    );
    return Math.min(
      OPEN_BRUSH_PRINT3D_MAX_POINTER_INTERVAL_METERS * localUnitsPerMeter,
      Math.max(
        OPEN_BRUSH_PRINT3D_MIN_POINTER_INTERVAL_METERS * localUnitsPerMeter,
        OPEN_BRUSH_PRINT3D_RING_INTERVAL_METERS,
      ),
    );
  }
  if (
    options.generatorClass === "HullBrush" ||
    options.generatorClass === "ConcaveHullBrush"
  ) {
    return solidMinLength;
  }
  return solidMinLength + pressuredSize * OPEN_BRUSH_SOLID_ASPECT_RATIO;
}

function normalizePositiveSamplingValue(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 1;
}

export function resolveStrokeSampleDecision(
  lastKeeperPosition: Vec3,
  nextPosition: Vec3,
  spawnIntervalMeters: number,
  minimumMoveMeters = OPEN_BRUSH_MINIMUM_MOVE_METERS,
): StrokeSampleDecision {
  const dx = nextPosition[0] - lastKeeperPosition[0];
  const dy = nextPosition[1] - lastKeeperPosition[1];
  const dz = nextPosition[2] - lastKeeperPosition[2];
  const distanceSq = dx * dx + dy * dy + dz * dz;
  if (distanceSq < minimumMoveMeters * minimumMoveMeters) {
    return "ignore";
  }
  return distanceSq >= spawnIntervalMeters * spawnIntervalMeters
    ? "keep"
    : "extend";
}

export function writeGridSnappedPosition(
  target: Vec3,
  source: Vec3,
  gridSize: number,
): void {
  if (gridSize <= 0) {
    target[0] = source[0];
    target[1] = source[1];
    target[2] = source[2];
    return;
  }

  target[0] = Math.round(source[0] / gridSize) * gridSize;
  target[1] = Math.round(source[1] / gridSize) * gridSize;
  target[2] = Math.round(source[2] / gridSize) * gridSize;
}

export function writeLazyInputPosition(
  target: Vec3,
  anchor: Vec3,
  source: Vec3,
  radius: number,
): void {
  if (radius <= 0) {
    target[0] = source[0];
    target[1] = source[1];
    target[2] = source[2];
    return;
  }

  const dx = source[0] - anchor[0];
  const dy = source[1] - anchor[1];
  const dz = source[2] - anchor[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distance <= radius) {
    target[0] = anchor[0];
    target[1] = anchor[1];
    target[2] = anchor[2];
    return;
  }

  const scale = (distance - radius) / distance;
  target[0] = anchor[0] + dx * scale;
  target[1] = anchor[1] + dy * scale;
  target[2] = anchor[2] + dz * scale;
}

export type StencilPlaneAxis = "x" | "y" | "z";
export const STRAIGHTEDGE_LINE_CONTROL_POINT_COUNT = 31;

export function writeStencilPlaneProjectedPosition(
  target: Vec3,
  source: Vec3,
  axis: StencilPlaneAxis,
  coordinate: number,
): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
  if (axis === "x") {
    target[0] = coordinate;
  } else if (axis === "y") {
    target[1] = coordinate;
  } else {
    target[2] = coordinate;
  }
}

export type StraightedgeSampleResult = "ignored" | "created" | "updated";

export function upsertStraightedgeEndpoint(
  controlPoints: ControlPoint[],
  frame: StrokePointerFrame,
  minDistance: number,
  sampleCount = STRAIGHTEDGE_LINE_CONTROL_POINT_COUNT,
): StraightedgeSampleResult {
  if (controlPoints.length === 0) {
    controlPoints.push(createStraightedgeControlPointFromFrame(frame));
    return "created";
  }

  if (
    !shouldSampleControlPoint(
      controlPoints[0].position,
      frame.position,
      minDistance,
    )
  ) {
    return "ignored";
  }

  const previousCount = controlPoints.length;
  writeStraightedgeLineControlPoints(controlPoints, controlPoints[0], frame, sampleCount);
  return previousCount === controlPoints.length ? "updated" : "created";
}

export function upsertTapeMeasureEndpoints(
  controlPoints: ControlPoint[],
  anchorFrame: StrokePointerFrame,
  endpointFrame: StrokePointerFrame,
  minDistance: number,
): StraightedgeSampleResult {
  if (
    !shouldSampleControlPoint(
      anchorFrame.position,
      endpointFrame.position,
      minDistance,
    )
  ) {
    return "ignored";
  }

  if (controlPoints.length === 0) {
    controlPoints.push(createControlPointFromFrame(anchorFrame));
    controlPoints.push(createControlPointFromFrame(endpointFrame));
    return "created";
  }

  writeControlPointFromFrame(controlPoints[0], anchorFrame);
  if (controlPoints.length === 1) {
    controlPoints.push(createControlPointFromFrame(endpointFrame));
    return "created";
  }

  writeControlPointFromFrame(controlPoints[1], endpointFrame);
  controlPoints.length = 2;
  return "updated";
}

export function createControlPointFromFrame(
  frame: StrokePointerFrame,
): ControlPoint {
  return {
    position: [frame.position[0], frame.position[1], frame.position[2]],
    orientation: [
      frame.orientation[0],
      frame.orientation[1],
      frame.orientation[2],
      frame.orientation[3],
    ],
    pressure: frame.pressure,
    timestampMs: frame.timestampMs,
  };
}

export function writeControlPointFromFrame(
  controlPoint: ControlPoint,
  frame: StrokePointerFrame,
): void {
  controlPoint.position[0] = frame.position[0];
  controlPoint.position[1] = frame.position[1];
  controlPoint.position[2] = frame.position[2];
  controlPoint.orientation[0] = frame.orientation[0];
  controlPoint.orientation[1] = frame.orientation[1];
  controlPoint.orientation[2] = frame.orientation[2];
  controlPoint.orientation[3] = frame.orientation[3];
  controlPoint.pressure = frame.pressure;
  controlPoint.timestampMs = frame.timestampMs;
}

function writeStraightedgeLineControlPoints(
  controlPoints: ControlPoint[],
  anchor: ControlPoint,
  endpointFrame: StrokePointerFrame,
  sampleCount: number,
): void {
  const resolvedSampleCount = Math.max(2, Math.floor(sampleCount));
  const startPosition: Vec3 = [
    anchor.position[0],
    anchor.position[1],
    anchor.position[2],
  ];
  const startTimestampMs = anchor.timestampMs;
  for (let index = 0; index < resolvedSampleCount; index += 1) {
    const amount = index / (resolvedSampleCount - 1);
    const controlPoint =
      controlPoints[index] ?? createStraightedgeControlPointFromFrame(endpointFrame);
    controlPoint.position[0] = lerp(
      startPosition[0],
      endpointFrame.position[0],
      amount,
    );
    controlPoint.position[1] = lerp(
      startPosition[1],
      endpointFrame.position[1],
      amount,
    );
    controlPoint.position[2] = lerp(
      startPosition[2],
      endpointFrame.position[2],
      amount,
    );
    controlPoint.orientation[0] = endpointFrame.orientation[0];
    controlPoint.orientation[1] = endpointFrame.orientation[1];
    controlPoint.orientation[2] = endpointFrame.orientation[2];
    controlPoint.orientation[3] = endpointFrame.orientation[3];
    controlPoint.pressure = STRAIGHTEDGE_PRESSURE;
    controlPoint.timestampMs = lerp(
      startTimestampMs,
      endpointFrame.timestampMs,
      amount,
    );
    controlPoints[index] = controlPoint;
  }
  controlPoints.length = resolvedSampleCount;
}

function createStraightedgeControlPointFromFrame(
  frame: StrokePointerFrame,
): ControlPoint {
  const controlPoint = createControlPointFromFrame(frame);
  controlPoint.pressure = STRAIGHTEDGE_PRESSURE;
  return controlPoint;
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function mirrorControlPointX(controlPoint: ControlPoint): ControlPoint {
  return {
    position: [
      -controlPoint.position[0],
      controlPoint.position[1],
      controlPoint.position[2],
    ],
    orientation: [
      controlPoint.orientation[0],
      controlPoint.orientation[1],
      controlPoint.orientation[2],
      controlPoint.orientation[3],
    ],
    pressure: controlPoint.pressure,
    timestampMs: controlPoint.timestampMs,
  };
}

export function createMirroredStrokeDataX(
  source: StrokeData,
  overrides: { guid: string; seed: number; groupId?: number },
): StrokeData {
  return {
    ...source,
    guid: overrides.guid,
    seed: overrides.seed,
    groupId: overrides.groupId ?? source.groupId,
    flags: source.flags | StrokeFlags.IsGroupContinue,
    color: [source.color[0], source.color[1], source.color[2], source.color[3]],
    controlPoints: source.controlPoints.map(mirrorControlPointX),
  };
}
