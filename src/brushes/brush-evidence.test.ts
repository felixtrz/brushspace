import { describe, expect, it } from "vitest";

import { openBrushInventory } from "./brush-catalog.js";
import { deriveBrushEvidence } from "./brush-evidence.js";
import type { BrushShaderCompatibilityRecord } from "./brush-shader-compatibility.js";

describe("brush fidelity evidence", () => {
  it("does not promote static renderer eligibility to validation", () => {
    const marker = openBrushInventory.find(
      ({ guid }) => guid === "429ed64a-4e97-4466-84d3-145a861ef684",
    )!;
    expect(deriveBrushEvidence(marker)).toEqual({
      asset: "extracted",
      rendererEligibility: "eligible",
      meshContract: "unvalidated",
      browserCompile: "unvalidated",
      immersiveXrCompile: "unvalidated",
      visual: "unvalidated",
    });
  });

  it("merges measured asset, browser, and XR shader outcomes", () => {
    const marker = openBrushInventory.find(
      ({ guid }) => guid === "429ed64a-4e97-4466-84d3-145a861ef684",
    )!;
    const records: BrushShaderCompatibilityRecord[] = [
      record(marker.guid, "asset-load", "ready", "2026-07-10T00:00:00Z"),
      record(marker.guid, "browser", "compile-failed", "2026-07-10T00:00:00Z"),
      record(marker.guid, "browser", "ready", "2026-07-11T00:00:00Z"),
      record(marker.guid, "immersive-xr", "compile-failed", "2026-07-11T00:00:00Z"),
      record(marker.guid, "visual", "visual-passed", "2026-07-11T00:00:01Z"),
    ];
    expect(deriveBrushEvidence(marker, records)).toMatchObject({
      asset: "load-passed",
      browserCompile: "passed",
      immersiveXrCompile: "failed",
      meshContract: "unvalidated",
      visual: "passed",
    });
  });

  it("keeps fallback and unavailable geometry explicit", () => {
    const marker = openBrushInventory.find(
      ({ guid }) => guid === "429ed64a-4e97-4466-84d3-145a861ef684",
    )!;
    const fallback = { ...marker, supportStatus: "fallback" as const };
    const unavailable = openBrushInventory.find(
      ({ supportStatus }) => supportStatus === "unsupported",
    )!;
    expect(deriveBrushEvidence(fallback).rendererEligibility).toBe("fallback");
    expect(deriveBrushEvidence(unavailable)).toMatchObject({
      rendererEligibility: "unavailable",
      meshContract: "failed",
    });
  });
});

function record(
  guid: string,
  context: BrushShaderCompatibilityRecord["context"],
  status: BrushShaderCompatibilityRecord["status"],
  checkedAt: string,
): BrushShaderCompatibilityRecord {
  return {
    guid,
    name: "Fixture",
    context,
    status,
    checkedAt,
    userAgent: "test",
  };
}
