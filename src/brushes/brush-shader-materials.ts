import type {
  BrushInventoryEntry,
  BrushTextureImporterSettings,
} from "./brush-inventory.js";
import { assetUrl } from "../app/asset-url.js";

export const OPENBRUSH_SHADER_BASE_URL = assetUrl("/openbrush/shaders/");
export const OPENBRUSH_TEXTURE_BASE_URL = assetUrl("/openbrush/textures/");
/** Generated strokes use Open Brush's original packed vertex layout. */
export const OPENBRUSH_USES_NEW_TILT_EXPORTER = false;

/** Open Brush export blend modes (IExportableMaterial.cs). */
export type BrushShaderBlending = "opaque" | "cutout" | "additive" | "alpha";

export interface BrushShaderTextureBinding {
  /** GLSL uniform name, e.g. "u_MainTex". */
  uniform: string;
  url: string;
  importer?: BrushTextureImporterSettings;
}

export interface BrushShaderMaterialDescriptor {
  guid: string;
  name: string;
  vertexUrl: string;
  fragmentUrl: string;
  textures: BrushShaderTextureBinding[];
  /** Uniform name → float or vec4 value, from manifest float/vector/color params and texture sizes. */
  uniforms: Record<string, number | [number, number, number, number]>;
  blending: BrushShaderBlending;
  transparent: boolean;
  depthWrite: boolean;
  doubleSided: boolean;
}

export interface BrushShaderEligibility {
  eligible: boolean;
  reason?: string;
}

export function resolveLoadedTextureTexelSize(
  image: unknown,
): [number, number, number, number] | undefined {
  const dimensions = image as
    | {
        width?: unknown;
        height?: unknown;
        naturalWidth?: unknown;
        naturalHeight?: unknown;
      }
    | undefined;
  const width = dimensions?.naturalWidth ?? dimensions?.width;
  const height = dimensions?.naturalHeight ?? dimensions?.height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }
  return [1 / width, 1 / height, width, height];
}

/**
 * A brush can use its exported GLSL program only when the port's generated
 * geometry satisfies the shader's vertex contract. VertDefault consumes
 * position/normal/color/texcoord0, which ribbon/tube geometry provides;
 * Genius particle shaders consume the packed center, rotation, birth time,
 * source position, and vertex ID emitted by their dedicated generator.
 */
export function getBrushShaderEligibility(
  entry: BrushInventoryEntry | undefined,
): BrushShaderEligibility {
  if (!entry?.shaderAssets) {
    return { eligible: false, reason: "Brush has no extracted GLSL shader assets." };
  }
  const hasGeniusParticleContract =
    entry.geometryFamily === "particle" &&
    entry.generatorClass === "GeniusParticlesBrush";
  const hasSprayParticleContract =
    entry.geometryFamily === "particle" &&
    entry.generatorClass === "SprayBrush" &&
    entry.shaderAssets.vertexIsDefault;
  const hasMidpointParticleContract =
    entry.geometryFamily === "particle" &&
    entry.generatorClass === "MidpointPlusLifetimeSprayBrush" &&
    (entry.shaderAssets.vertexIsDefault || entry.name === "HyperGrid");
  const hasWaveformContract =
    entry.geometryFamily === "emissive" &&
    entry.name === "Waveform" &&
    entry.generatorClass === "QuadStripBrushStretchUV";
  const hasDoubleTaperedContract =
    entry.geometryFamily === "ribbon" &&
    (entry.name === "DoubleTaperedMarker" ||
      entry.name === "DoubleTaperedFlat") &&
    entry.geometryParams?.ribbonOffsetInTexcoord1 === true;
  const hasElectricityContract =
    entry.geometryFamily === "emissive" &&
    entry.name === "Electricity" &&
    entry.generatorClass === "FlatGeometryBrush" &&
    entry.geometryParams?.ribbonOffsetInTexcoord1 === true;
  const hasRadiusPackedTubeContract =
    entry.geometryFamily === "tube" &&
    (entry.name === "Disco" || entry.name === "LightWire") &&
    entry.generatorClass === "TubeBrush" &&
    entry.geometryParams?.tubeStoreRadiusInTexcoord0Z === true;
  const hasHullContract =
    (entry.geometryFamily === "hull" && entry.generatorClass === "HullBrush") ||
    (entry.geometryFamily === "concave-hull" &&
      entry.generatorClass === "ConcaveHullBrush");
  if (
    !entry.shaderAssets.vertexIsDefault &&
    !hasGeniusParticleContract &&
    !hasMidpointParticleContract &&
    !hasWaveformContract &&
    !hasDoubleTaperedContract &&
    !hasElectricityContract &&
    !hasRadiusPackedTubeContract &&
    !hasHullContract
  ) {
    return {
      eligible: false,
      reason: "Brush vertex shader needs vertex data the geometry generator does not emit yet.",
    };
  }
  if (
    !hasGeniusParticleContract &&
    !hasSprayParticleContract &&
    !hasMidpointParticleContract &&
    entry.geometryFamily !== "ribbon" &&
    entry.geometryFamily !== "emissive" &&
    entry.geometryFamily !== "thick-strip" &&
    entry.geometryFamily !== "hull" &&
    entry.geometryFamily !== "concave-hull" &&
    entry.geometryFamily !== "print3d" &&
    entry.geometryFamily !== "tube"
  ) {
    return {
      eligible: false,
      reason: `Geometry family "${entry.geometryFamily}" does not satisfy the shader vertex contract yet.`,
    };
  }
  return { eligible: true };
}

export function resolveBrushShaderBlending(blendMode: number): BrushShaderBlending {
  switch (blendMode) {
    case 1:
      return "cutout";
    case 2:
      return "additive";
    case 3:
      return "alpha";
    default:
      return "opaque";
  }
}

export function createBrushShaderMaterialDescriptor(
  entry: BrushInventoryEntry,
  options?: { allowAnyGeometry?: boolean },
): BrushShaderMaterialDescriptor | undefined {
  const assets = entry.shaderAssets;
  if (!assets) {
    return undefined;
  }
  // The eligibility gate exists because OUR generated stroke geometry only
  // suits default-vertex brushes; baked meshes (the intro sketch) carry the
  // original attributes, so any brush shader can run on them.
  if (!options?.allowAnyGeometry && !getBrushShaderEligibility(entry).eligible) {
    return undefined;
  }

  const uniforms: BrushShaderMaterialDescriptor["uniforms"] = {};
  for (const [param, value] of Object.entries(entry.floatParams ?? {})) {
    uniforms[`u_${param}`] = value;
  }
  for (const [param, value] of Object.entries(entry.vectorParams ?? {})) {
    uniforms[`u_${param}`] = [...value] as [number, number, number, number];
  }
  for (const [param, value] of Object.entries(entry.colorParams ?? {})) {
    uniforms[`u_${param}`] = [...value] as [number, number, number, number];
  }
  for (const [param, size] of Object.entries(entry.textureSizes ?? {})) {
    const [width, height] = size;
    if (width > 0 && height > 0) {
      // Unity's <name>_TexelSize convention: (1/w, 1/h, w, h).
      uniforms[`u_${param}_TexelSize`] = [1 / width, 1 / height, width, height];
    }
  }

  const textures: BrushShaderTextureBinding[] = Object.entries(assets.textureFiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([param, file]) => ({
      uniform: `u_${param}`,
      url: `${OPENBRUSH_TEXTURE_BASE_URL}${file}`,
      importer: assets.textureImporters[param],
    }));

  const blending = resolveBrushShaderBlending(entry.blendMode);
  const doubleSided = entry.geometryParams?.renderBackfaces ?? !entry.enableCull;
  return {
    guid: entry.guid,
    name: entry.name,
    vertexUrl: `${OPENBRUSH_SHADER_BASE_URL}${assets.vertexShaderFile}`,
    fragmentUrl: `${OPENBRUSH_SHADER_BASE_URL}${assets.fragmentShaderFile}`,
    textures,
    uniforms,
    blending,
    transparent: blending === "additive" || blending === "alpha",
    depthWrite: blending === "opaque" || blending === "cutout",
    doubleSided,
  };
}

/**
 * Prepares an exported GLSL 1.00 source for compilation as a non-raw
 * three.js ShaderMaterial. Non-raw materials are required for XR: super-three
 * only applies its GLSL3 conversion and OVR_multiview patching (per-view
 * matrix arrays + distinct program cache keys) to non-raw programs — a
 * RawShaderMaterial renders into the multiview framebuffer with a mono
 * program, which is an INVALID_OPERATION and draws nothing in-headset.
 *
 * Three's non-raw prefix already declares the built-in matrix uniforms (and
 * rewrites them to per-view arrays under multiview), so the shader's own
 * declarations must be dropped to avoid duplicate/broken declarations.
 * Derivative functions are core in GLSL ES 3.00, but the exported derivative
 * bump branch produced black strokes on Quest hardware. The guarded replacement
 * below rejects degenerate derivatives and falls back per fragment instead of
 * poisoning the whole stroke; defining the reserved GL_* extension macro is not
 * legal GLSL.
 */
export type BrushBumpMappingMode = "fallback" | "guarded";

const GUARDED_BUMP_NORMAL_GLSL = `uniform sampler2D u_BumpMap;
uniform vec4 u_BumpMap_TexelSize;

vec3 PerturbNormal(vec3 position, vec3 normal, vec2 uv) {
  highp vec3 positionDx = dFdx(position);
  highp vec3 positionDy = dFdy(position);
  highp vec2 uvDx = dFdx(uv);
  highp vec2 uvDy = dFdy(uv);
  highp float determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
  highp float safeDeterminant = determinant >= 0.0
    ? max(determinant, 1e-8)
    : min(determinant, -1e-8);
  highp vec3 positionDu =
    (uvDy.y * positionDx - uvDx.y * positionDy) / safeDeterminant;
  highp vec3 positionDv =
    (-uvDy.x * positionDx + uvDx.x * positionDy) / safeDeterminant;

  highp vec2 texel = max(u_BumpMap_TexelSize.xy, vec2(1e-6));
  highp float heightCenter = texture2D(u_BumpMap, uv).x;
  highp float heightU = texture2D(u_BumpMap, uv + vec2(texel.x, 0.0)).x;
  highp float heightV = texture2D(u_BumpMap, uv + vec2(0.0, texel.y)).x;
  highp float faceSign = gl_FrontFacing ? 1.0 : -1.0;
  highp float heightDu =
    (heightU - heightCenter) * dispAmount * faceSign / texel.x;
  highp float heightDv =
    (heightV - heightCenter) * dispAmount * faceSign / texel.y;
  highp vec3 candidate = cross(
    positionDu + normal * heightDu,
    positionDv + normal * heightDv
  );
  highp float candidateLengthSquared = dot(candidate, candidate);
  bool invalid =
    abs(determinant) < 1e-8 ||
    !(candidateLengthSquared > 1e-12) ||
    candidateLengthSquared > 1e12;
  if (invalid) {
    return normal;
  }
  candidate *= inversesqrt(candidateLengthSquared);
  return dot(candidate, normal) < 0.0 ? -candidate : candidate;
}
`;

export function prepareBrushShaderSource(
  source: string,
  bumpMappingMode: BrushBumpMappingMode = "guarded",
): string {
  const aliasedSource = renameDeclaredStandardAttribute(
    renameDeclaredStandardAttribute(source, "position", "a_position"),
    "color",
    "a_color",
  );
  const hasCustomInverse = /\bmat4\s+inverse\s*\(\s*mat4\b/.test(aliasedSource);
  return (
    aliasedSource
      .replace(
        /^[ \t]*uniform[ \t]+(?:highp[ \t]+|mediump[ \t]+|lowp[ \t]+)?(?:mat4[ \t]+(?:modelViewMatrix|projectionMatrix|viewMatrix|modelMatrix)|mat3[ \t]+normalMatrix|vec3[ \t]+cameraPosition)[ \t]*;[^\n]*\n?/gm,
        "",
      )
      .replace(/^[ \t]*#extension[ \t]+GL_OES_standard_derivatives[^\n]*\n?/gm, "")
      .replace(
        /^[ \t]*#ifndef[ \t]+GL_OES_standard_derivatives\b[^\n]*\n([\s\S]*?)^[ \t]*#else[^\n]*\n[\s\S]*?^[ \t]*#endif[^\n]*\n?/gm,
        (_match, fallback: string) =>
          bumpMappingMode === "guarded"
            ? GUARDED_BUMP_NORMAL_GLSL
            : fallback,
      )
      // The particle shaders ship their own mat4 inverse(), legal in the
      // exported GLSL 1.00 but a redeclaration of the built-in once three
      // promotes the source to GLSL ES 3.00 — rename definition and calls.
      .replace(
        /\binverse\b(?=\s*\()/g,
        hasCustomInverse ? "tb_inverse" : "inverse",
      )
  );
}

function renameDeclaredStandardAttribute(
  source: string,
  standardName: string,
  alias: string,
): string {
  const declaration = new RegExp(
    `^[ \\t]*(?:attribute|in)[ \\t]+(?:highp[ \\t]+|mediump[ \\t]+|lowp[ \\t]+)?vec3[ \\t]+${standardName}[ \\t]*;`,
    "m",
  );
  if (!declaration.test(source)) {
    return source;
  }
  return source.replace(new RegExp(`\\b${standardName}\\b`, "g"), alias);
}

/**
 * Scene lighting rig used by the exported shaders, taken verbatim from the
 * official tiltbrush.com viewer export of the "Standard" environment
 * (reference/Support/bin/gltfViewer/geom/ExampleSketch/Untitled.gltf).
 * Matrices are column-major light→world transforms; the shaders derive the
 * light direction as mat3(view * lightWorld) * (0,0,1).
 */
export const OPENBRUSH_SCENE_LIGHT_0_MATRIX: readonly number[] = [
  0.898794, 0.2191856, -0.3796406, 0, -0.4383712, 0.449397, -0.7783785, 0,
  -1.490116e-8, 0.8660254, 0.4999999, 0, 0, 0.021875, 0.05458749, 1,
];
export const OPENBRUSH_SCENE_LIGHT_1_MATRIX: readonly number[] = [
  0.7660444, -0.4924039, -0.4131759, 0, -0.6427876, -0.5868242, -0.4924039, 0,
  8.940697e-8, 0.6427876, -0.7660446, 0, 0, 0.021875, 0.05458749, 1,
];
export const OPENBRUSH_SCENE_LIGHT_0_COLOR: readonly number[] = [
  0.7780392, 0.8156863, 0.9913726, 1,
];
export const OPENBRUSH_SCENE_LIGHT_1_COLOR: readonly number[] = [
  0.4282353, 0.4211765, 0.3458824, 1,
];
export const OPENBRUSH_AMBIENT_LIGHT_COLOR: readonly number[] = [
  0.3921569, 0.3921569, 0.3921569, 1,
];
export const OPENBRUSH_FOG_COLOR: readonly number[] = [0.1647059, 0.1647059, 0.2078431];

/**
 * Unity _Time convention consumed by the animated shaders: (t/20, t, 2t, 3t).
 * Exposed as a pure helper so tests can pin the packing.
 */
export function packBrushShaderTime(
  timeSeconds: number,
): [number, number, number, number] {
  return [timeSeconds / 20, timeSeconds, timeSeconds * 2, timeSeconds * 3];
}

export function hasBrushMainTextureCutout(fragmentShader: string): boolean {
  return (
    /texture\s*\(\s*u_MainTex\s*,\s*v_texcoord0\s*\)/.test(fragmentShader) &&
    /mainTex\.a\s*\*\s*v_color\.a\s*<\s*u_Cutoff/.test(fragmentShader) &&
    /\bdiscard\s*;/.test(fragmentShader)
  );
}

export function hasTubeToonInvertedPassContract(
  vertexShader: string,
  fragmentShader: string,
): boolean {
  return (
    /uniform\s+highp\s+float\s+u_TubeToonPass\s*;/.test(vertexShader) &&
    /uniform\s+highp\s+float\s+u_TubeToonOutlineSize\s*;/.test(vertexShader) &&
    vertexShader.includes("a_normal.y * 0.2") &&
    /uniform\s+highp\s+float\s+u_TubeToonPass\s*;/.test(fragmentShader) &&
    fragmentShader.includes("bool blackPass")
  );
}
