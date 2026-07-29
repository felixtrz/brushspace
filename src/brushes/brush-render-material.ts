import {
  type BufferGeometry,
  type Material,
  type ShaderMaterial,
} from "@iwsdk/core";
import {
  applyTiltBrushRenderGroups,
  createTiltBrushRenderMaterial,
  ELECTRICITY_BRUSH_GUID,
  ELECTRICITY_DISPLACEMENT_MODS,
  TOON_BRUSH_GUID,
  TUBE_TOON_INVERTED_BRUSH_GUID,
} from "three-icosa";
export {
  ELECTRICITY_BRUSH_GUID,
  ELECTRICITY_DISPLACEMENT_MODS,
  TOON_BRUSH_GUID,
  TUBE_TOON_INVERTED_BRUSH_GUID,
};

interface UniformHolder {
  value: unknown;
}

const electricityMaterials = new WeakMap<ShaderMaterial, ShaderMaterial[]>();
const toonMaterials = new WeakMap<ShaderMaterial, ShaderMaterial[]>();
const tubeToonInvertedMaterials = new WeakMap<
  ShaderMaterial,
  ShaderMaterial[]
>();

/** Recreates the three Unity passes used by the Electricity brush. */
export function createBrushRenderMaterial(
  brushGuid: string,
  source: Material,
  sharedUniforms: Record<string, UniformHolder> = {},
): Material | Material[] {
  if (!("uniforms" in source)) {
    return source;
  }
  const shader = source as ShaderMaterial;
  const normalizedGuid = brushGuid.toLowerCase();
  if (normalizedGuid === TUBE_TOON_INVERTED_BRUSH_GUID) {
    const cached = tubeToonInvertedMaterials.get(shader);
    if (cached) {
      return cached;
    }
    const passes = createTiltBrushRenderMaterial(
      brushGuid,
      shader,
      sharedUniforms,
    ) as ShaderMaterial[];
    tubeToonInvertedMaterials.set(shader, passes);
    return passes;
  }
  if (normalizedGuid === TOON_BRUSH_GUID) {
    const cached = toonMaterials.get(shader);
    if (cached) {
      return cached;
    }
    const passes = createTiltBrushRenderMaterial(
      brushGuid,
      shader,
      sharedUniforms,
    ) as ShaderMaterial[];
    toonMaterials.set(shader, passes);
    return passes;
  }
  if (normalizedGuid !== ELECTRICITY_BRUSH_GUID) {
    return source;
  }
  const cached = electricityMaterials.get(shader);
  if (cached) {
    return cached;
  }
  const passes = createTiltBrushRenderMaterial(
    brushGuid,
    shader,
    sharedUniforms,
  ) as ShaderMaterial[];
  electricityMaterials.set(shader, passes);
  return passes;
}

export function applyBrushRenderGroups(
  geometry: BufferGeometry,
  indexCount: number,
  material: Material | Material[],
): void {
  applyTiltBrushRenderGroups(geometry, indexCount, material);
}
