import type {
  BrowserBrushMeshDump,
  BrowserStrokeMeshDump,
} from "./brush-conformance-dump.js";

export interface BrushMeshTolerances {
  position: number;
  normal: number;
  tangent: number;
  color: number;
  uv0: number;
  bounds: number;
}

export interface BrushMeshComparison {
  passed: boolean;
  issues: string[];
  maximumErrors: Record<keyof BrushMeshTolerances, number>;
}

export const EXACT_BRUSH_MESH_TOLERANCES: BrushMeshTolerances = {
  position: 0,
  normal: 0,
  tangent: 0,
  color: 0,
  uv0: 0,
  bounds: 0,
};

export function compareBrushMeshDumps(
  actual: BrowserBrushMeshDump,
  reference: BrowserBrushMeshDump,
  tolerances: BrushMeshTolerances = EXACT_BRUSH_MESH_TOLERANCES,
): BrushMeshComparison {
  const issues: string[] = [];
  const maximumErrors: BrushMeshComparison["maximumErrors"] = {
    position: 0,
    normal: 0,
    tangent: 0,
    color: 0,
    uv0: 0,
    bounds: 0,
  };
  if (actual.brush.guid !== reference.brush.guid) {
    issues.push(`Brush GUID differs: ${actual.brush.guid} != ${reference.brush.guid}.`);
  }
  if (actual.fixture !== reference.fixture) {
    issues.push(`Fixture differs: ${actual.fixture} != ${reference.fixture}.`);
  }
  if (actual.strokes.length !== reference.strokes.length) {
    issues.push(
      `Stroke count differs: ${actual.strokes.length} != ${reference.strokes.length}.`,
    );
  }
  const strokeCount = Math.min(actual.strokes.length, reference.strokes.length);
  for (let index = 0; index < strokeCount; index += 1) {
    compareStroke(
      actual.strokes[index],
      reference.strokes[index],
      index,
      tolerances,
      maximumErrors,
      issues,
    );
  }
  return { passed: issues.length === 0, issues, maximumErrors };
}

function compareStroke(
  actual: BrowserStrokeMeshDump,
  reference: BrowserStrokeMeshDump,
  strokeIndex: number,
  tolerances: BrushMeshTolerances,
  maximumErrors: BrushMeshComparison["maximumErrors"],
  issues: string[],
): void {
  compareExactArray(actual.indices, reference.indices, strokeIndex, "indices", issues);
  compareFloatArray(
    actual.positions,
    reference.positions,
    strokeIndex,
    "positions",
    "position",
    tolerances.position,
    maximumErrors,
    issues,
  );
  compareFloatArray(actual.normals, reference.normals, strokeIndex, "normals", "normal", tolerances.normal, maximumErrors, issues);
  compareFloatArray(actual.tangents, reference.tangents, strokeIndex, "tangents", "tangent", tolerances.tangent, maximumErrors, issues);
  compareFloatArray(actual.colors, reference.colors, strokeIndex, "colors", "color", tolerances.color, maximumErrors, issues);
  if (actual.uv0Size !== reference.uv0Size) {
    issues.push(
      `Stroke ${strokeIndex} UV0 size differs: ${actual.uv0Size} != ${reference.uv0Size}.`,
    );
  }
  compareFloatArray(actual.uv0, reference.uv0, strokeIndex, "uv0", "uv0", tolerances.uv0, maximumErrors, issues);
  compareFloatArray(
    [...actual.bounds.min, ...actual.bounds.max],
    [...reference.bounds.min, ...reference.bounds.max],
    strokeIndex,
    "bounds",
    "bounds",
    tolerances.bounds,
    maximumErrors,
    issues,
  );
}

function compareExactArray(
  actual: number[],
  reference: number[],
  strokeIndex: number,
  channel: string,
  issues: string[],
): void {
  if (actual.length !== reference.length) {
    issues.push(
      `Stroke ${strokeIndex} ${channel} count differs: ${actual.length} != ${reference.length}.`,
    );
    return;
  }
  const mismatch = actual.findIndex((value, index) => value !== reference[index]);
  if (mismatch >= 0) {
    issues.push(
      `Stroke ${strokeIndex} ${channel}[${mismatch}] differs: ${actual[mismatch]} != ${reference[mismatch]}.`,
    );
  }
}

function compareFloatArray(
  actual: number[],
  reference: number[],
  strokeIndex: number,
  channel: string,
  metric: keyof BrushMeshTolerances,
  tolerance: number,
  maximumErrors: BrushMeshComparison["maximumErrors"],
  issues: string[],
): void {
  if (actual.length !== reference.length) {
    issues.push(
      `Stroke ${strokeIndex} ${channel} count differs: ${actual.length} != ${reference.length}.`,
    );
    return;
  }
  let maximum = 0;
  let maximumIndex = 0;
  for (let index = 0; index < actual.length; index += 1) {
    const error = Math.abs(actual[index] - reference[index]);
    if (error > maximum) {
      maximum = error;
      maximumIndex = index;
    }
  }
  maximumErrors[metric] = Math.max(maximumErrors[metric], maximum);
  if (!Number.isFinite(maximum) || maximum > tolerance) {
    issues.push(
      `Stroke ${strokeIndex} ${channel} max error ${maximum} at ${maximumIndex} exceeds ${tolerance}.`,
    );
  }
}
