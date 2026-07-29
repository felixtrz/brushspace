import { ShaderMaterial } from "@iwsdk/core";
import { describe, expect, it, vi } from "vitest";

import {
  applyBrushRenderGroups,
  createBrushRenderMaterial,
  ELECTRICITY_BRUSH_GUID,
  ELECTRICITY_DISPLACEMENT_MODS,
  TOON_BRUSH_GUID,
  TUBE_TOON_INVERTED_BRUSH_GUID,
} from "./brush-render-material.js";
import { BufferGeometry } from "@iwsdk/core";

vi.mock("@iwsdk/core", () => {
  class MockShaderMaterial {
    uniforms: Record<string, { value: unknown }>;

    constructor(params: { uniforms?: Record<string, { value: unknown }> } = {}) {
      this.uniforms = { ...(params.uniforms ?? {}) };
    }

    clone() {
      return new MockShaderMaterial({
        uniforms: Object.fromEntries(
          Object.entries(this.uniforms).map(([name, holder]) => [
            name,
            { value: holder.value },
          ]),
        ),
      });
    }
  }
  return {
    BackSide: 1,
    FrontSide: 0,
    ShaderMaterial: MockShaderMaterial,
    BufferGeometry: class {
    groups: Array<{ start: number; count: number; materialIndex: number }> = [];

    clearGroups() {
      this.groups.length = 0;
    }

    addGroup(start: number, count: number, materialIndex: number) {
      this.groups.push({ start, count, materialIndex });
    }
    },
  };
});

describe("Open Brush material passes", () => {
  it("recreates all three Electricity displacement passes", () => {
    const source = new ShaderMaterial({ uniforms: { u_time: { value: 0 } } });
    const time = { value: 1.5 };
    const materials = createBrushRenderMaterial(
      ELECTRICITY_BRUSH_GUID,
      source,
      { u_time: time },
    );
    expect(materials).toHaveLength(3);
    expect(
      (materials as ShaderMaterial[]).map(
        (material) => material.uniforms.u_DisplacementMod.value,
      ),
    ).toEqual([...ELECTRICITY_DISPLACEMENT_MODS]);
    expect(
      (materials as ShaderMaterial[]).every(
        (material) => material.uniforms.u_time === time,
      ),
    ).toBe(true);
  });

  it("adds one overlapping draw group per pass", () => {
    const geometry = new BufferGeometry();
    const materials = ELECTRICITY_DISPLACEMENT_MODS.map(
      () => new ShaderMaterial(),
    );
    applyBrushRenderGroups(geometry, 18, materials);
    expect(geometry.groups).toEqual([
      { start: 0, count: 18, materialIndex: 0 },
      { start: 0, count: 18, materialIndex: 1 },
      { start: 0, count: 18, materialIndex: 2 },
    ]);
  });

  it("recreates the Toon surface and outline passes", () => {
    const source = new ShaderMaterial();
    const materials = createBrushRenderMaterial(
      TOON_BRUSH_GUID,
      source,
    ) as ShaderMaterial[];
    expect(materials).toHaveLength(2);
    expect(materials.map((material) => material.side)).toEqual([0, 1]);
    expect(
      materials.map(
        (material) => material.uniforms.u_ToonOutlinePass.value,
      ),
    ).toEqual([false, true]);
  });

  it("recreates the inverted Toon base and inflated color passes", () => {
    const source = new ShaderMaterial();
    const materials = createBrushRenderMaterial(
      TUBE_TOON_INVERTED_BRUSH_GUID,
      source,
    ) as ShaderMaterial[];
    expect(materials).toHaveLength(2);
    expect(materials.map((material) => material.side)).toEqual([0, 1]);
    expect(
      materials.map(
        (material) => material.uniforms.u_TubeToonPass.value,
      ),
    ).toEqual([1, 2]);
    expect(
      materials.map(
        (material) => material.uniforms.u_TubeToonOutlineSize.value,
      ),
    ).toEqual([0.05, 0.05]);
  });
});
