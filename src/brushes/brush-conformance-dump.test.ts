import { describe, expect, it } from "vitest";

import { openBrushInventory } from "./brush-catalog.js";
import { dumpBrowserBrushFixture } from "./brush-conformance-dump.js";
import { createBrushConformanceFixtures } from "./brush-conformance-fixtures.js";

describe("browser brush conformance dumps", () => {
  it("serializes every generated mesh channel and resolved material state", () => {
    const brush = openBrushInventory.find(
      (entry) => entry.geometryFamily === "ribbon" && entry.supportStatus === "supported",
    )!;
    const fixture = createBrushConformanceFixtures().find(
      ({ name }) => name === "line",
    )!;
    const dump = dumpBrowserBrushFixture(brush, fixture);
    const mesh = dump.strokes[0];
    const vertexCount = mesh.positions.length / 3;

    expect(dump.schemaVersion).toBe(1);
    expect(dump.brush.guid).toBe(brush.guid);
    expect(dump.fixture).toBe("line");
    expect(dump.material?.guid).toBe(brush.guid);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.normals).toHaveLength(vertexCount * 3);
    expect(mesh.tangents).toHaveLength(vertexCount * 4);
    expect(mesh.colors).toHaveLength(vertexCount * 4);
    expect(mesh.uv0).toHaveLength(vertexCount * mesh.uv0Size);
    expect(mesh.bounds.min).toHaveLength(3);
    expect(mesh.bounds.max).toHaveLength(3);
    expect(() => JSON.parse(JSON.stringify(dump))).not.toThrow();
  });

  it("preserves packed three-component UV0 layouts", () => {
    const brush = openBrushInventory.find(
      (entry) =>
        entry.geometryFamily === "tube" &&
        entry.geometryParams?.tubeStoreRadiusInTexcoord0Z === true,
    )!;
    const fixture = createBrushConformanceFixtures().find(
      ({ name }) => name === "arc",
    )!;
    const mesh = dumpBrowserBrushFixture(brush, fixture).strokes[0];

    expect(mesh.uv0Size).toBe(3);
    expect(mesh.uv0).toHaveLength((mesh.positions.length / 3) * 3);
    expect(mesh.uv0.some((value, index) => index % 3 === 2 && value > 0)).toBe(
      true,
    );
  });

  it("keeps explicit segment breaks as separate mesh records", () => {
    const brush = openBrushInventory.find(
      (entry) => entry.geometryFamily === "ribbon" && entry.supportStatus === "supported",
    )!;
    const fixture = createBrushConformanceFixtures().find(
      ({ name }) => name === "segment-break",
    )!;

    expect(dumpBrowserBrushFixture(brush, fixture).strokes).toHaveLength(2);
  });
});
