import type { BrushConformanceFixture } from "./brush-conformance-fixtures.js";
import {
  generateBrushGeometry,
  type BrushGeometryBounds,
} from "./brush-geometry.js";
import type { BrushInventoryEntry } from "./brush-inventory.js";
import {
  createBrushShaderMaterialDescriptor,
  type BrushShaderMaterialDescriptor,
} from "./brush-shader-materials.js";

export interface BrowserBrushMeshDump {
  schemaVersion: 1;
  brush: {
    guid: string;
    name: string;
    generatorClass?: string;
    geometryFamily: string;
  };
  fixture: string;
  material: BrushShaderMaterialDescriptor | null;
  strokes: BrowserStrokeMeshDump[];
}

export interface BrowserStrokeMeshDump {
  guid: string;
  positions: number[];
  indices: number[];
  normals: number[];
  tangents: number[];
  colors: number[];
  uv0: number[];
  uv0Size: 2 | 3 | 4;
  uv1Size: 0 | 3 | 4;
  uv1?: number[];
  bounds: BrushGeometryBounds;
  warning?: string;
}

/**
 * Produces JSON-safe browser output with the same semantic channels required
 * from the Unity exporter. No rounding is applied: comparison code decides
 * tolerances, while exact ports can compare the original float values.
 */
export function dumpBrowserBrushFixture(
  entry: BrushInventoryEntry,
  fixture: BrushConformanceFixture,
): BrowserBrushMeshDump {
  return {
    schemaVersion: 1,
    brush: {
      guid: entry.guid,
      name: entry.name,
      generatorClass: entry.generatorClass,
      geometryFamily: entry.geometryFamily,
    },
    fixture: fixture.name,
    material: createBrushShaderMaterialDescriptor(entry) ?? null,
    strokes: fixture.strokes.map((stroke) => {
      const geometry = generateBrushGeometry(stroke, entry.geometryFamily, {
        pressureSizeRange: entry.pressureSizeRange,
        pressureOpacityRange: entry.pressureOpacityRange,
        geometryParams: entry.geometryParams,
        generatorClass: entry.generatorClass,
      });
      return {
        guid: stroke.guid,
        positions: Array.from(geometry.positions),
        indices: Array.from(geometry.indices),
        normals: Array.from(geometry.normals),
        tangents: Array.from(geometry.tangents),
        colors: Array.from(geometry.colors),
        uv0: Array.from(geometry.packedUvs ?? geometry.uvs),
        uv0Size: geometry.uv0Size,
        uv1Size: geometry.uv1Size,
        uv1: geometry.uv1 ? Array.from(geometry.uv1) : undefined,
        bounds: {
          min: [...geometry.bounds.min],
          max: [...geometry.bounds.max],
        },
        warning: geometry.warning,
      };
    }),
  };
}
