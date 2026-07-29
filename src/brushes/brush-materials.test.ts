import { describe, expect, it } from "vitest";

import referenceManifest from "./generated/exportManifest.json";
import generatedBrushAssets from "./generated/brush-assets.json";

import {
  buildBrushInventoryFromExportManifest,
  findBrushByGuid,
  type BrushInventoryEntry,
  type BrushAssetRecord,
  type OpenBrushExportManifest,
} from "./brush-inventory.js";
import { createBrushMaterialSpec } from "./brush-materials.js";

const inventory = buildBrushInventoryFromExportManifest(
  referenceManifest as unknown as OpenBrushExportManifest,
  generatedBrushAssets.brushes as unknown as Record<string, BrushAssetRecord>,
);

describe("brush material conversion", () => {
  it("converts marker cutout texture metadata without treating Unity shaders as portable", () => {
    const spec = createBrushMaterialSpec(
      getBrush("429ed64a-4e97-4466-84d3-145a861ef684"),
      [1, 1, 1, 1],
    );

    expect(spec).toMatchObject({
      materialFamily: "unlit",
      shaderRewrite: "semantic-family",
      sourceBlendMode: 1,
      blending: "alpha-cutout",
      transparent: false,
      depthWrite: true,
      doubleSided: true,
      alphaCutoff: 0.067,
    });
    expect(spec.textureSlots).toEqual([
      {
        name: "MainTex",
        fileName: "Marker-429ed64a-4e97-4466-84d3-145a861ef684-v10.0-MainTex.png",
        assetKey:
          "openbrush-brush-texture:429ed64a-4e97-4466-84d3-145a861ef684:MainTex",
        size: [64, 256],
      },
    ]);
  });

  it("converts additive light brush emission and depth behavior", () => {
    const spec = createBrushMaterialSpec(
      getBrush("2241cd32-8ba2-48a5-9ee7-2caef7e9ed62"),
      [0.4, 0.8, 1, 1],
    );

    expect(spec).toMatchObject({
      materialFamily: "additive",
      shaderRewrite: "semantic-family",
      sourceBlendMode: 2,
      blending: "additive",
      transparent: true,
      depthWrite: false,
      emissiveIntensity: 0.45,
    });
    expect(spec.textureSlots[0]).toMatchObject({
      name: "MainTex",
      size: [512, 256],
    });
  });

  it("keeps known cutout brushes out of ordinary alpha blending", () => {
    const spec = createBrushMaterialSpec(
      getBrush("429ed64a-4e97-4466-84d3-145a861ef684"),
      [1, 1, 1, 0.5],
    );

    expect(spec.blending).toBe("alpha-cutout");
    expect(spec.transparent).toBe(false);
    expect(spec.depthWrite).toBe(true);
  });

  it("preserves culling decisions for tube brushes", () => {
    const spec = createBrushMaterialSpec(
      getBrush("8e58ceea-7830-49b4-aba9-6215104ab52a"),
      [1, 0, 0, 1],
    );

    expect(spec).toMatchObject({
      materialFamily: "standard",
      sourceBlendMode: 0,
      blending: "opaque",
      doubleSided: false,
      transparent: false,
      depthWrite: true,
    });
    expect(spec.textureSlots[0]?.fileName).toBe(
      "MylarTube-8e58ceea-7830-49b4-aba9-6215104ab52a-v10.0-MainTex.png",
    );
  });

  it("uses the real Genius particle shader while keeping texture slots", () => {
    const spec = createBrushMaterialSpec(
      getBrush("70d79cca-b159-4f35-990c-f02193947fe8"),
      [1, 1, 1, 1],
    );

    expect(spec).toMatchObject({
      materialFamily: "particle",
      shaderRewrite: "semantic-family",
      sourceBlendMode: 2,
      blending: "additive",
      transparent: true,
      depthWrite: false,
    });
    expect(spec.warning).toBeUndefined();
    expect(spec.textureSlots[0]).toMatchObject({
      name: "MainTex",
      size: [512, 512],
    });
  });

  it("creates a safe fallback material for unknown brushes", () => {
    const spec = createBrushMaterialSpec(undefined, [1, 1, 1, 0.5]);

    expect(spec).toMatchObject({
      materialFamily: "fallback",
      shaderRewrite: "fallback",
      sourceBlendMode: 0,
      blending: "transparent",
      transparent: true,
      depthWrite: false,
      doubleSided: true,
      textureSlots: [],
    });
    expect(spec.warning).toContain("missing from the Open Brush inventory");
  });
});

function getBrush(guid: string): BrushInventoryEntry {
  const entry = findBrushByGuid(inventory, guid);
  if (!entry) {
    throw new Error(`Missing brush ${guid}`);
  }
  return entry;
}
