import type { BrushInventoryEntry, BrushMaterialFamily } from "./brush-inventory.js";
import type { Rgba } from "../types.js";

export type BrushBlendingMode =
  | "opaque"
  | "alpha-cutout"
  | "transparent"
  | "additive";
export type BrushShaderRewrite = "semantic-family" | "fallback";

export interface BrushTextureSlot {
  name: string;
  fileName: string;
  assetKey: string;
  size?: [number, number];
}

export interface BrushMaterialSpec {
  materialFamily: BrushMaterialFamily;
  shaderRewrite: BrushShaderRewrite;
  sourceBlendMode: number;
  blending: BrushBlendingMode;
  transparent: boolean;
  depthWrite: boolean;
  doubleSided: boolean;
  vertexColors: boolean;
  alphaCutoff: number;
  emissiveIntensity: number;
  textureSlots: BrushTextureSlot[];
  warning?: string;
}

export function createBrushMaterialSpec(
  entry: BrushInventoryEntry | undefined,
  color: Rgba,
): BrushMaterialSpec {
  if (!entry) {
    return {
      materialFamily: "fallback",
      shaderRewrite: "fallback",
      sourceBlendMode: 0,
      blending: color[3] < 1 ? "transparent" : "opaque",
      transparent: color[3] < 1,
      depthWrite: color[3] >= 1,
      doubleSided: true,
      vertexColors: true,
      alphaCutoff: 0,
      emissiveIntensity: 0,
      textureSlots: [],
      warning: "Brush is missing from the Open Brush inventory; using fallback material.",
    };
  }

  const base = createFamilyMaterialSpec(entry.materialFamily, color);
  base.sourceBlendMode = entry.blendMode;
  base.doubleSided = !entry.enableCull;
  base.alphaCutoff = getFloatParam(entry, "Cutoff");
  base.emissiveIntensity = getFloatParam(entry, "EmissionGain");
  base.textureSlots = createTextureSlots(entry);
  base.blending = resolveBlendMode(entry, base.alphaCutoff);
  base.transparent =
    base.blending === "transparent" ||
    base.blending === "additive";
  base.depthWrite =
    base.blending === "opaque" ||
    base.blending === "alpha-cutout";
  if (entry.supportStatus !== "supported") {
    base.shaderRewrite = "fallback";
    base.warning =
      entry.unsupportedReason ??
      "Brush material is not supported yet; using fallback material.";
  }
  return base;
}

function createFamilyMaterialSpec(
  family: BrushMaterialFamily,
  color: Rgba,
): BrushMaterialSpec {
  const transparent = color[3] < 1;
  switch (family) {
    case "additive":
      return {
        materialFamily: family,
        shaderRewrite: "semantic-family",
        sourceBlendMode: 2,
        blending: "additive",
        transparent: true,
        depthWrite: false,
        doubleSided: true,
        vertexColors: true,
        alphaCutoff: 0,
        emissiveIntensity: 1,
        textureSlots: [],
      };
    case "particle":
      return {
        materialFamily: family,
        shaderRewrite: "semantic-family",
        sourceBlendMode: 2,
        blending: "additive",
        transparent: true,
        depthWrite: false,
        doubleSided: true,
        vertexColors: true,
        alphaCutoff: 0,
        emissiveIntensity: 0,
        textureSlots: [],
      };
    case "fallback":
      return {
        materialFamily: family,
        shaderRewrite: "fallback",
        sourceBlendMode: 0,
        blending: transparent ? "transparent" : "opaque",
        transparent,
        depthWrite: !transparent,
        doubleSided: true,
        vertexColors: true,
        alphaCutoff: 0,
        emissiveIntensity: 0,
        textureSlots: [],
        warning: "Brush uses fallback material.",
      };
    case "standard":
    case "unlit":
      return {
        materialFamily: family,
        shaderRewrite: "semantic-family",
        sourceBlendMode: 0,
        blending: "opaque",
        transparent: false,
        depthWrite: true,
        doubleSided: true,
        vertexColors: true,
        alphaCutoff: 0,
        emissiveIntensity: 0,
        textureSlots: [],
      };
  }
}

function resolveBlendMode(
  entry: BrushInventoryEntry,
  alphaCutoff: number,
): BrushBlendingMode {
  if (entry.blendMode === 2 || entry.materialFamily === "additive") {
    return "additive";
  }
  if (entry.blendMode === 1 || alphaCutoff > 0) {
    return "alpha-cutout";
  }
  return "opaque";
}

function createTextureSlots(entry: BrushInventoryEntry): BrushTextureSlot[] {
  return Object.entries(entry.textures ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, fileName]) => ({
      name,
      fileName,
      assetKey: `openbrush-brush-texture:${entry.guid}:${name}`,
      size: entry.textureSizes?.[name],
    }));
}

function getFloatParam(entry: BrushInventoryEntry, name: string): number {
  const value = entry.floatParams?.[name];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
