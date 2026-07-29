import { describe, expect, it } from "vitest";

import { openBrushInventory } from "./brush-catalog.js";
import { compareBrushMeshDumps } from "./brush-conformance-compare.js";
import {
  dumpBrowserBrushFixture,
  type BrowserBrushMeshDump,
} from "./brush-conformance-dump.js";
import { createBrushConformanceFixtures } from "./brush-conformance-fixtures.js";

function createDump(): BrowserBrushMeshDump {
  const brush = openBrushInventory.find(
    (entry) => entry.geometryFamily === "ribbon" && entry.supportStatus === "supported",
  )!;
  const fixture = createBrushConformanceFixtures().find(
    ({ name }) => name === "line",
  )!;
  return dumpBrowserBrushFixture(brush, fixture);
}

function cloneDump(dump: BrowserBrushMeshDump): BrowserBrushMeshDump {
  return JSON.parse(JSON.stringify(dump)) as BrowserBrushMeshDump;
}

describe("brush mesh conformance comparison", () => {
  it("passes identical dumps with exact tolerances", () => {
    const dump = createDump();
    expect(compareBrushMeshDumps(dump, cloneDump(dump))).toMatchObject({
      passed: true,
      issues: [],
    });
  });

  it("requires topology to match exactly", () => {
    const reference = createDump();
    const actual = cloneDump(reference);
    actual.strokes[0].indices[0] += 1;

    const comparison = compareBrushMeshDumps(actual, reference, {
      position: 1,
      normal: 1,
      tangent: 1,
      color: 1,
      uv0: 1,
      bounds: 1,
    });
    expect(comparison.passed).toBe(false);
    expect(comparison.issues).toContain(
      `Stroke 0 indices[0] differs: ${actual.strokes[0].indices[0]} != ${reference.strokes[0].indices[0]}.`,
    );
  });

  it("reports maximum channel error against declared tolerances", () => {
    const reference = createDump();
    const actual = cloneDump(reference);
    actual.strokes[0].positions[3] += 0.005;

    const passing = compareBrushMeshDumps(actual, reference, {
      position: 0.01,
      normal: 0,
      tangent: 0,
      color: 0,
      uv0: 0,
      bounds: 0,
    });
    expect(passing.passed).toBe(true);
    expect(passing.maximumErrors.position).toBeCloseTo(0.005);

    const failing = compareBrushMeshDumps(actual, reference, {
      position: 0.001,
      normal: 0,
      tangent: 0,
      color: 0,
      uv0: 0,
      bounds: 0,
    });
    expect(failing.passed).toBe(false);
    expect(failing.issues[0]).toContain("positions max error");
  });
});
