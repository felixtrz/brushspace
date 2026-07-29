import {
  ShaderMaterial,
  type ShaderMaterialParameters,
} from "@iwsdk/core";

import { prepareBrushShaderSource } from "./brush-shader-materials.js";

/**
 * IWSDK material boundary for three-icosa brush bindings.
 *
 * three-icosa remains responsible for shader selection, uniforms, textures,
 * and render state. Brushspace only selects a non-raw material so super-three
 * can apply its XR multiview program rewriting.
 */
export function createIwsdkTiltMaterial(
  params: ShaderMaterialParameters,
  brushName: string,
): ShaderMaterial {
  const material = new ShaderMaterial({
    ...params,
    name: params.name ?? `OpenBrushShader_${brushName}`,
    vertexShader: prepareBrushShaderSource(params.vertexShader ?? ""),
    fragmentShader: prepareBrushShaderSource(params.fragmentShader ?? ""),
  });
  material.index0AttributeName = "a_position";
  return material;
}
