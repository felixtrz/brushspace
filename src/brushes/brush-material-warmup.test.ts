import { describe, expect, it } from "vitest";

import type { BrushInventoryEntry } from "./brush-inventory.js";
import { createBrushMaterialWarmupPlan } from "./brush-material-warmup.js";

describe("createBrushMaterialWarmupPlan", () => {
  it("deduplicates equivalent supported material variants", () => {
    const plan = createBrushMaterialWarmupPlan([
      createBrush({ guid: "brush-a", materialFamily: "standard" }),
      createBrush({ guid: "brush-b", materialFamily: "standard" }),
    ]);

    expect(plan.supportedBrushCount).toBe(2);
    expect(plan.fallbackBrushCount).toBe(0);
    expect(plan.unsupportedBrushCount).toBe(0);
    expect(plan.variants).toHaveLength(1);
    expect(plan.variants[0].brushGuids).toEqual(["brush-a", "brush-b"]);
    expect(plan.warnings).toEqual([]);
  });

  it("keeps additive as the only transparent known-brush variant", () => {
    const plan = createBrushMaterialWarmupPlan([
      createBrush({ guid: "additive", materialFamily: "additive", blendMode: 2 }),
      createBrush({ guid: "standard", materialFamily: "standard" }),
    ]);

    expect(plan.transparentVariantCount).toBe(1);
    expect(plan.variants.some((variant) => variant.blending === "additive")).toBe(
      true,
    );
    expect(
      plan.variants.some((variant) => variant.blending === "transparent"),
    ).toBe(false);
  });

  it("keeps fallback and unsupported brushes on explicit warning paths", () => {
    const plan = createBrushMaterialWarmupPlan([
      createBrush({
        guid: "fallback",
        supportStatus: "fallback",
        materialFamily: "particle",
        unsupportedReason: "Particle rewrite pending.",
      }),
      createBrush({
        guid: "unsupported",
        supportStatus: "unsupported",
        geometryFamily: "unsupported",
        materialFamily: "fallback",
        unsupportedReason: "No IWSDK mapping yet.",
      }),
    ]);

    expect(plan.supportedBrushCount).toBe(0);
    expect(plan.fallbackBrushCount).toBe(1);
    expect(plan.unsupportedBrushCount).toBe(1);
    expect(plan.warnings).toEqual([
      "fallback: Particle rewrite pending.",
      "unsupported: No IWSDK mapping yet.",
    ]);
    expect(plan.variants.some((variant) => variant.materialFamily === "fallback"))
      .toBe(true);
  });

  it("accounts for texture slot count in variant keys", () => {
    const plan = createBrushMaterialWarmupPlan([
      createBrush({
        guid: "textured",
        materialFamily: "standard",
        textures: { MainTex: "main.png" },
      }),
      createBrush({ guid: "untextured", materialFamily: "standard" }),
    ]);

    expect(plan.variants.some((variant) => variant.textureSlotCount === 1)).toBe(
      true,
    );
    expect(plan.variants.some((variant) => variant.textureSlotCount === 0)).toBe(
      true,
    );
  });
});

function createBrush(
  overrides: Partial<BrushInventoryEntry> & Pick<BrushInventoryEntry, "guid">,
): BrushInventoryEntry {
  return {
    guid: overrides.guid,
    name: overrides.name ?? overrides.guid,
    folderName: overrides.folderName ?? overrides.guid,
    shaderVersion: overrides.shaderVersion ?? "1",
    blendMode: overrides.blendMode ?? 0,
    enableCull: overrides.enableCull ?? false,
    textures: overrides.textures,
    textureSizes: overrides.textureSizes,
    floatParams: overrides.floatParams,
    vectorParams: overrides.vectorParams,
    colorParams: overrides.colorParams,
    supportStatus: overrides.supportStatus ?? "supported",
    fidelityConfidence:
      overrides.fidelityConfidence ?? "likely-mostly-correct",
    pickerVisible: overrides.pickerVisible ?? true,
    pickerEnabled: overrides.pickerEnabled ?? true,
    portRequired: overrides.portRequired ?? true,
    tags: overrides.tags ?? ["default"],
    geometryFamily: overrides.geometryFamily ?? "ribbon",
    materialFamily: overrides.materialFamily ?? "standard",
    brushSizeRange: overrides.brushSizeRange ?? [0.05, 3],
    pressureSizeRange: overrides.pressureSizeRange ?? [0.1, 1],
    pressureOpacityRange: overrides.pressureOpacityRange ?? [1, 1],
    unsupportedReason: overrides.unsupportedReason,
  };
}
