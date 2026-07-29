import type { BrushInventoryEntry } from "./brush-inventory.js";
import type {
  BrushShaderCompatibilityContext,
  BrushShaderCompatibilityRecord,
} from "./brush-shader-compatibility.js";

export type BrushAssetEvidence =
  | "missing"
  | "extracted"
  | "load-passed"
  | "load-failed";
export type BrushEligibilityEvidence = "eligible" | "fallback" | "unavailable";
export type BrushValidationEvidence = "unvalidated" | "passed" | "failed";

export interface BrushEvidence {
  asset: BrushAssetEvidence;
  rendererEligibility: BrushEligibilityEvidence;
  meshContract: BrushValidationEvidence;
  browserCompile: BrushValidationEvidence;
  immersiveXrCompile: BrushValidationEvidence;
  visual: BrushValidationEvidence;
}

/**
 * Keeps static eligibility distinct from measured compatibility and fidelity.
 * A default-vertex brush is not called validated until separate mesh/image
 * evidence exists for it.
 */
export function deriveBrushEvidence(
  entry: BrushInventoryEntry,
  compatibility: readonly BrushShaderCompatibilityRecord[] = [],
): BrushEvidence {
  const assetResult = latestRecord(entry.guid, "asset-load", compatibility);
  return {
    asset: !entry.shaderAssets
      ? "missing"
      : assetResult?.status === "load-failed"
        ? "load-failed"
        : assetResult?.status === "ready"
          ? "load-passed"
          : "extracted",
    rendererEligibility:
      entry.supportStatus === "supported"
        ? "eligible"
        : entry.supportStatus === "fallback"
          ? "fallback"
          : "unavailable",
    meshContract:
      entry.geometryFamily === "unsupported" ? "failed" : "unvalidated",
    browserCompile: compileEvidence(
      latestRecord(entry.guid, "browser", compatibility),
    ),
    immersiveXrCompile: compileEvidence(
      latestRecord(entry.guid, "immersive-xr", compatibility),
    ),
    visual: visualEvidence(latestRecord(entry.guid, "visual", compatibility)),
  };
}

function visualEvidence(
  record: BrushShaderCompatibilityRecord | undefined,
): BrushValidationEvidence {
  if (!record) return "unvalidated";
  return record.status === "visual-passed" ? "passed" : "failed";
}

function latestRecord(
  guid: string,
  context: BrushShaderCompatibilityContext,
  records: readonly BrushShaderCompatibilityRecord[],
): BrushShaderCompatibilityRecord | undefined {
  return records
    .filter(
      (record) =>
        record.context === context &&
        record.guid.toLowerCase() === guid.toLowerCase(),
    )
    .sort((left, right) => right.checkedAt.localeCompare(left.checkedAt))[0];
}

function compileEvidence(
  record: BrushShaderCompatibilityRecord | undefined,
): BrushValidationEvidence {
  if (!record) {
    return "unvalidated";
  }
  return record.status === "ready" ? "passed" : "failed";
}
