import { describe, expect, it } from "vitest";

import referenceManifest from "./generated/exportManifest.json";
import generatedBrushAssets from "./generated/brush-assets.json";
import {
  buildBrushInventoryFromExportManifest,
  findBrushByGuid,
  summarizeBrushInventory,
  type BrushAssetRecord,
  type OpenBrushExportManifest,
} from "./brush-inventory.js";

function loadReferenceManifest(): OpenBrushExportManifest {
  return referenceManifest as unknown as OpenBrushExportManifest;
}

describe("Open Brush brush inventory", () => {
  it("builds an inventory from the real Open Brush export manifest", () => {
    const inventory = buildBrushInventoryFromExportManifest(
      loadReferenceManifest(),
      generatedBrushAssets.brushes as unknown as Record<string, BrushAssetRecord>,
    );
    const summary = summarizeBrushInventory(inventory);

    expect(summary.total).toBe(123);
    // Implemented extrusion, particle, thick-strip, and convex-hull contracts
    // are supported; remaining special generators stay unsupported.
    expect(summary.supported).toBe(111);
    expect(summary.fallback).toBe(0);
    expect(summary.unsupported).toBe(12);
  });

  it("derives brush families and ranges from the extracted reference data", () => {
    const inventory = buildBrushInventoryFromExportManifest(
      loadReferenceManifest(),
      generatedBrushAssets.brushes as unknown as Record<string, BrushAssetRecord>,
    );

    expect(
      findBrushByGuid(inventory, "429ed64a-4e97-4466-84d3-145a861ef684"),
    ).toMatchObject({
      name: "Marker",
      supportStatus: "supported",
      geometryFamily: "ribbon",
      materialFamily: "unlit",
      pickerVisible: true,
      pickerEnabled: true,
      fidelityConfidence: "likely-mostly-correct",
      brushSizeRange: [0.05, 3],
      pressureSizeRange: [0.1, 1],
      pressureOpacityRange: [1, 1],
    });
    expect(
      findBrushByGuid(inventory, "faaa4d44-fcfb-4177-96be-753ac0421ba3"),
    ).toMatchObject({
      name: "ShinyHull",
      supportStatus: "supported",
      geometryFamily: "hull",
      pickerVisible: true,
      pickerEnabled: true,
      fidelityConfidence: "likely-mostly-correct",
    });
    expect(
      findBrushByGuid(inventory, "d3f3b18a-da03-f694-b838-28ba8e749a98"),
    ).toMatchObject({
      name: "3D Printing Brush",
      supportStatus: "supported",
      geometryFamily: "print3d",
      pickerEnabled: true,
      fidelityConfidence: "likely-mostly-correct",
    });
    expect(
      findBrushByGuid(inventory, "2d35bcf0-e4d8-452c-97b1-3311be063130"),
    ).toMatchObject({
      name: "Flat",
      supportStatus: "supported",
      geometryFamily: "ribbon",
      brushSizeRange: [0.025, 3],
      pressureSizeRange: [1, 1],
      pressureOpacityRange: [1, 1],
    });
    expect(
      findBrushByGuid(inventory, "2241cd32-8ba2-48a5-9ee7-2caef7e9ed62"),
    ).toMatchObject({
      name: "Light",
      supportStatus: "supported",
      geometryFamily: "emissive",
      materialFamily: "additive",
      brushSizeRange: [0.05, 0.2],
      pressureSizeRange: [0.15, 1],
      pressureOpacityRange: [0.5, 1],
    });
    expect(
      findBrushByGuid(inventory, "8e58ceea-7830-49b4-aba9-6215104ab52a"),
    ).toMatchObject({
      name: "MylarTube",
      supportStatus: "supported",
      geometryFamily: "tube",
      brushSizeRange: [0.08, 1],
      pressureSizeRange: [0.25, 1],
      pressureOpacityRange: [1, 1],
    });
    expect(
      findBrushByGuid(inventory, "70d79cca-b159-4f35-990c-f02193947fe8"),
    ).toMatchObject({
      name: "Smoke",
      supportStatus: "supported",
      geometryFamily: "particle",
      materialFamily: "particle",
      pickerVisible: true,
      brushSizeRange: [1, 2],
      pressureSizeRange: [0.2, 1],
      pressureOpacityRange: [1, 1],
      geometryParams: {
        particleRate: 0.05,
        particleSpeed: 0.1,
        particleInitialRotationRange: 360,
        particleRandomizeAlpha: false,
        particleSizeVariance: 0,
        particlePositionVariance: 0,
        particleRotationVariance: 360,
        particleSizeRatio: [1, 1],
      },
    });
    expect(
      findBrushByGuid(inventory, "8dc4a70c-d558-4efd-a5ed-d4e860f40dc3"),
    ).toMatchObject({
      name: "Splatter",
      generatorClass: "SprayBrush",
      geometryParams: {
        sprayRateMultiplier: 3,
      },
    });
  });

  it("preserves standard then experimental Open Brush manifest order", () => {
    const inventory = buildBrushInventoryFromExportManifest(
      loadReferenceManifest(),
      generatedBrushAssets.brushes as unknown as Record<string, BrushAssetRecord>,
    );
    const standard = inventory.filter((entry) => entry.catalogSection === "standard");
    const experimental = inventory.filter(
      (entry) => entry.catalogSection === "experimental",
    );

    expect(standard).toHaveLength(48);
    expect(experimental).toHaveLength(51);
    expect(standard.slice(0, 12).map((entry) => entry.name)).toEqual([
      "OilPaint",
      "Ink",
      "ThickPaint",
      "WetPaint",
      "Marker",
      "TaperedMarker",
      "DoubleTaperedMarker",
      "Highlighter",
      "Flat",
      "TaperedFlat",
      "DoubleTaperedFlat",
      "SoftHighlighter",
    ]);
    expect(inventory.indexOf(experimental[0])).toBeGreaterThan(
      inventory.indexOf(standard[standard.length - 1]),
    );

    const required = inventory.filter((entry) => entry.portRequired);
    expect(required.filter((entry) => entry.catalogSection === "standard")).toHaveLength(
      48,
    );
    expect(
      required.filter((entry) => entry.catalogSection === "experimental"),
    ).toHaveLength(47);
    expect(
      experimental
        .filter((entry) => !entry.portRequired)
        .map((entry) => entry.name),
    ).toEqual(["CandyCane", "HolidayTree", "Snowflake", "Braid3"]);
  });

  it("rejects manifest entries whose map key does not match their brush GUID", () => {
    expect(() =>
      buildBrushInventoryFromExportManifest({
        brushes: {
          "00000000-0000-0000-0000-000000000000": {
            guid: "11111111-1111-1111-1111-111111111111",
            name: "Broken",
            folderName: "Broken",
            shaderVersion: "0",
            blendMode: 0,
            enableCull: false,
          },
        },
      }),
    ).toThrow(/does not match/);
  });
});
