import { describe, expect, it } from "vitest";

import {
  openBrushInventory,
  selectableOpenBrushes,
  visibleOpenBrushes,
} from "./brush-catalog.js";
import { findBrushByGuid } from "./brush-inventory.js";
import { generateBrushGeometry } from "./brush-geometry.js";
import {
  createBrushShaderMaterialDescriptor,
  getBrushShaderEligibility,
  hasBrushMainTextureCutout,
  hasTubeToonInvertedPassContract,
  packBrushShaderTime,
  prepareBrushShaderSource,
  resolveLoadedTextureTexelSize,
  resolveBrushShaderBlending,
  OPENBRUSH_USES_NEW_TILT_EXPORTER,
} from "./brush-shader-materials.js";
import { createEmptyStrokeData } from "../types.js";

const LIGHT_GUID = "2241cd32-8ba2-48a5-9ee7-2caef7e9ed62";
const OIL_PAINT_GUID = "f72ec0e7-a844-4e38-82e3-140c44772699";
const MARKER_GUID = "429ed64a-4e97-4466-84d3-145a861ef684";
const MYLAR_TUBE_GUID = "8e58ceea-7830-49b4-aba9-6215104ab52a";
const PETAL_GUID = "e0abbc80-0f80-e854-4970-8924a0863dcc";
const SMOKE_GUID = "70d79cca-b159-4f35-990c-f02193947fe8";
const TAPERED_MARKER_FLAT_GUID = "1a26b8c0-8a07-4f8a-9fac-d2ef36e0cad0";

function getBrush(guid: string) {
  const entry = findBrushByGuid(openBrushInventory, guid);
  if (!entry) {
    throw new Error(`Missing brush ${guid}`);
  }
  return entry;
}

describe("brush shader asset inventory", () => {
  it("attaches extracted shader assets to every manifest brush", () => {
    const withAssets = openBrushInventory.filter((entry) => entry.shaderAssets);
    expect(withAssets.length).toBe(openBrushInventory.length);

    const handcrafted = withAssets.filter(
      (entry) => entry.shaderAssets?.glslSource === "handcrafted",
    );
    const template = withAssets.filter(
      (entry) => entry.shaderAssets?.glslSource === "template",
    );
    expect(handcrafted.length).toBe(74);
    expect(template.length).toBe(49);
  });

  it("shows all 48 standard brushes but enables only likely-mostly-correct entries", () => {
    expect(visibleOpenBrushes.length).toBe(48);
    expect(selectableOpenBrushes.length).toBe(48);
    for (const entry of selectableOpenBrushes) {
      expect(entry.tags, entry.name).toContain("default");
      expect(entry.catalogSection, entry.name).toBe("standard");
    }
    const names = visibleOpenBrushes.map((entry) => entry.name);
    expect(names).toContain("Light");
    expect(names).toContain("Marker");
    expect(names).toContain("Smoke");
    expect(names).not.toContain("DuctTapeGeometry");
    expect(names).not.toContain("Fire2");
    expect(names.slice(0, 12)).toEqual([
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
  });

  it("resolves textures and geometry params for the selectable brushes", () => {
    for (const entry of selectableOpenBrushes) {
      expect(entry.shaderAssets, entry.name).toBeDefined();
      expect(entry.geometryParams, entry.name).toBeDefined();
      for (const param of Object.keys(entry.textures ?? {})) {
        expect(entry.shaderAssets?.textureFiles[param], `${entry.name}:${param}`).toBe(
          entry.textures?.[param],
        );
      }
    }
  });

  it("marks Light's brush-size range consistent with the extracted descriptor", () => {
    const light = getBrush(LIGHT_GUID);
    expect(light.geometryParams?.textureAtlasV).toBe(1);
    expect(light.geometryParams?.renderBackfaces).toBe(true);
    expect(light.geometryParams?.audioReactive).toBe(true);
  });

  it("extracts TubeBrush prefab settings per brush", () => {
    expect(getBrush(MYLAR_TUBE_GUID).geometryParams).toMatchObject({
      tubeSideCount: 8,
      tubeEndCaps: true,
      tubeHardEdges: false,
      tubeUvStyle: "stretch",
      tubeShapeModifier: 0,
      tubeCapAspect: 0.8,
    });
    expect(getBrush(PETAL_GUID).geometryParams).toMatchObject({
      tubeSideCount: 5,
      tubeEndCaps: false,
      tubeHardEdges: true,
      tubeUvStyle: "stretch",
      tubeShapeModifier: 5,
      tubePetalDisplacementAmount: 1.5,
    });
  });

  it("preserves non-default texture importer settings", () => {
    expect(getBrush(OIL_PAINT_GUID).shaderAssets?.textureImporters.MainTex).toEqual({
      sRGB: true,
      mipmaps: true,
      filter: "bilinear",
      wrapU: "clamp",
      wrapV: "clamp",
      anisotropy: 4,
      mipBias: 0,
    });
  });
});

describe("brush shader eligibility", () => {
  it("accepts ribbon/emissive/tube brushes with a default vertex stage", () => {
    expect(getBrushShaderEligibility(getBrush(LIGHT_GUID)).eligible).toBe(true);
    expect(getBrushShaderEligibility(getBrush(MARKER_GUID)).eligible).toBe(true);
    expect(getBrushShaderEligibility(getBrush(MYLAR_TUBE_GUID)).eligible).toBe(true);
  });

  it("accepts Genius particles with the packed vertex contract", () => {
    const smoke = getBrushShaderEligibility(getBrush(SMOKE_GUID));
    expect(smoke.eligible).toBe(true);
  });

  it("accepts Spray particles with the default vertex contract", () => {
    const splatter = openBrushInventory.find(
      (entry) => entry.name === "Splatter" && entry.generatorClass === "SprayBrush",
    );
    expect(getBrushShaderEligibility(splatter).eligible).toBe(true);
  });

  it("accepts Midpoint lifetime particles with their packed UV1 contract", () => {
    const danceFloor = openBrushInventory.find(
      (entry) => entry.name === "DanceFloor",
    );
    expect(getBrushShaderEligibility(danceFloor).eligible).toBe(true);
  });

  it("accepts HyperGrid's Midpoint UV1 quantization contract", () => {
    const hyperGrid = openBrushInventory.find(
      (entry) => entry.name === "HyperGrid",
    );
    expect(getBrushShaderEligibility(hyperGrid).eligible).toBe(true);
  });

  it("accepts Waveform's custom color-only vertex shader", () => {
    const waveform = openBrushInventory.find((entry) => entry.name === "Waveform");
    expect(getBrushShaderEligibility(waveform).eligible).toBe(true);
  });

  it("accepts DoubleTapered shaders with packed edge offsets", () => {
    const tapered = openBrushInventory.find(
      (entry) => entry.name === "DoubleTaperedMarker",
    );
    expect(getBrushShaderEligibility(tapered).eligible).toBe(true);
  });

  it("accepts Electricity's packed edge-offset vertex contract", () => {
    const electricity = openBrushInventory.find(
      (entry) => entry.name === "Electricity",
    );
    expect(electricity?.shaderAssets?.vertexIsDefault).toBe(false);
    expect(getBrushShaderEligibility(electricity).eligible).toBe(true);
  });

  it.each(["Disco", "LightWire"])(
    "accepts %s's radius-packed tube contract",
    (name) => {
      const entry = openBrushInventory.find((brush) => brush.name === name);
      expect(entry?.geometryParams?.tubeStoreRadiusInTexcoord0Z).toBe(true);
      expect(getBrushShaderEligibility(entry).eligible).toBe(true);
    },
  );

  it("rejects brushes without extracted assets", () => {
    expect(getBrushShaderEligibility(undefined).eligible).toBe(false);
  });
});

describe("brush shader material descriptors", () => {
  it("recognizes the maintained diffuse texture cutout contract", () => {
    expect(
      hasBrushMainTextureCutout(`
        vec4 mainTex = texture(u_MainTex, v_texcoord0);
        if (mainTex.a * v_color.a < u_Cutoff) { discard; }
      `),
    ).toBe(true);
    expect(hasBrushMainTextureCutout("fragColor = v_color;")).toBe(false);
  });

  it("recognizes the opt-in inverted Toon pass contract", () => {
    expect(
      hasTubeToonInvertedPassContract(
        "uniform highp float u_TubeToonPass; uniform highp float u_TubeToonOutlineSize; vec3 color = a_normal.y * 0.2;",
        "uniform highp float u_TubeToonPass; bool blackPass = true;",
      ),
    ).toBe(true);
    expect(hasTubeToonInvertedPassContract("", "")).toBe(false);
  });

  it("selects the original Open Brush packed vertex layout explicitly", () => {
    expect(OPENBRUSH_USES_NEW_TILT_EXPORTER).toBe(false);
  });

  it("derives texel-size uniforms from the loaded runtime image", () => {
    expect(resolveLoadedTextureTexelSize({ width: 1024, height: 512 })).toEqual([
      1 / 1024,
      1 / 512,
      1024,
      512,
    ]);
    expect(resolveLoadedTextureTexelSize({ naturalWidth: 0, naturalHeight: 0 })).toBeUndefined();
    expect(resolveLoadedTextureTexelSize(undefined)).toBeUndefined();
  });

  it("builds the Light descriptor with bloom gain, additive blending, and its falloff texture", () => {
    const descriptor = createBrushShaderMaterialDescriptor(getBrush(LIGHT_GUID));
    expect(descriptor).toMatchObject({
      guid: LIGHT_GUID,
      name: "Light",
      blending: "additive",
      transparent: true,
      depthWrite: false,
      doubleSided: true,
    });
    expect(descriptor?.vertexUrl).toBe(
      "/openbrush/shaders/Light-2241cd32-8ba2-48a5-9ee7-2caef7e9ed62-v10.0-vertex.glsl",
    );
    expect(descriptor?.uniforms.u_EmissionGain).toBe(0.45);
    expect(descriptor?.uniforms.u_MainTex_TexelSize).toEqual([
      1 / 512,
      1 / 256,
      512,
      256,
    ]);
    expect(descriptor?.textures).toEqual([
      {
        uniform: "u_MainTex",
        url: "/openbrush/textures/Light-2241cd32-8ba2-48a5-9ee7-2caef7e9ed62-v10.0-MainTex.png",
        importer: {
          sRGB: false,
          mipmaps: true,
          filter: "bilinear",
          wrapU: "repeat",
          wrapV: "repeat",
          anisotropy: 1,
          mipBias: 0,
        },
      },
    ]);
  });

  it("builds the Marker descriptor as a depth-writing cutout", () => {
    const descriptor = createBrushShaderMaterialDescriptor(getBrush(MARKER_GUID));
    expect(descriptor).toMatchObject({
      blending: "cutout",
      transparent: false,
      depthWrite: true,
    });
    expect(descriptor?.uniforms.u_Cutoff).toBeCloseTo(0.067);
    expect(descriptor?.textures[0]?.importer?.sRGB).toBe(true);
  });

  it("builds the MylarTube descriptor from the template pipeline", () => {
    const entry = getBrush(MYLAR_TUBE_GUID);
    expect(entry.shaderAssets?.glslSource).toBe("template");
    const descriptor = createBrushShaderMaterialDescriptor(entry);
    expect(descriptor).toMatchObject({
      blending: "opaque",
      transparent: false,
      depthWrite: true,
      doubleSided: false,
    });
    expect(descriptor?.uniforms.u_Shininess).toBeCloseTo(0.68);
    expect(descriptor?.uniforms.u_SpecColor).toEqual([0.75, 0.75, 0.75, 0]);
  });

  it("uses the exported render-backfaces contract instead of material culling", () => {
    const entry = getBrush(TAPERED_MARKER_FLAT_GUID);
    expect(entry.enableCull).toBe(true);
    expect(entry.geometryParams?.renderBackfaces).toBe(true);
    expect(createBrushShaderMaterialDescriptor(entry)?.doubleSided).toBe(true);
  });

  it("maps every Open Brush export blend mode", () => {
    expect(resolveBrushShaderBlending(0)).toBe("opaque");
    expect(resolveBrushShaderBlending(1)).toBe("cutout");
    expect(resolveBrushShaderBlending(2)).toBe("additive");
    expect(resolveBrushShaderBlending(3)).toBe("alpha");
  });

  it("packs u_time with the Unity _Time convention", () => {
    expect(packBrushShaderTime(2)).toEqual([0.1, 2, 4, 6]);
  });
});

describe("shader source preparation for non-raw ShaderMaterial", () => {
  it("strips built-in uniform declarations that three's prefix provides", () => {
    const source = [
      "attribute vec4 a_position;",
      "uniform mat4 modelViewMatrix;",
      "uniform mat4 projectionMatrix;",
      "uniform mat4 viewMatrix;",
      "uniform mat4 modelMatrix;",
      "uniform mat3 normalMatrix;",
      "uniform vec3 cameraPosition;",
      "uniform mat4 u_SceneLight_0_matrix;",
      "void main() { gl_Position = projectionMatrix * modelViewMatrix * a_position; }",
    ].join("\n");
    const prepared = prepareBrushShaderSource(source);
    expect(prepared).not.toMatch(/uniform mat4 modelViewMatrix;/);
    expect(prepared).not.toMatch(/uniform mat4 projectionMatrix;/);
    expect(prepared).not.toMatch(/uniform mat4 viewMatrix;/);
    expect(prepared).not.toMatch(/uniform mat4 modelMatrix;/);
    expect(prepared).not.toMatch(/uniform mat3 normalMatrix;/);
    expect(prepared).not.toMatch(/uniform vec3 cameraPosition;/);
    // Usages and brush-specific uniforms are untouched.
    expect(prepared).toContain("uniform mat4 u_SceneLight_0_matrix;");
    expect(prepared).toContain(
      "gl_Position = projectionMatrix * modelViewMatrix * a_position;",
    );
  });

  it("aliases declared standard position and RGB color attributes", () => {
    const prepared = prepareBrushShaderSource(
      "in vec3 position;\nin vec3 color;\nvoid main() { gl_Position = vec4(position, 1.0); v_color = vec4(color, 1.0); }",
    );
    expect(prepared).toContain("in vec3 a_position;");
    expect(prepared).toContain("in vec3 a_color;");
    expect(prepared).toContain("vec4(a_position, 1.0)");
    expect(prepared).toContain("vec4(a_color, 1.0)");
  });

  it("strips the derivatives extension directive (core in GLSL ES 3.00)", () => {
    const prepared = prepareBrushShaderSource(
      "#extension GL_OES_standard_derivatives : enable\nvoid main() { float w = fwidth(1.0); }",
    );
    expect(prepared).not.toContain("#extension");
    expect(prepared).toContain("fwidth");
  });

  it("can explicitly select the flat-normal fallback without defining a GL_* macro", () => {
    const prepared = prepareBrushShaderSource(`#ifndef GL_OES_standard_derivatives
vec3 PerturbNormal(vec3 position, vec3 normal, vec2 uv) { return normal; }
#else
uniform sampler2D u_BumpMap;
vec3 PerturbNormal(vec3 position, vec3 normal, vec2 uv) { return dFdx(position); }
#endif
void main() {}`, "fallback");

    expect(prepared).not.toContain("uniform sampler2D u_BumpMap;");
    expect(prepared).not.toContain("return dFdx(position);");
    expect(prepared).toContain("return normal;");
    expect(prepared).not.toContain("#define GL_OES_standard_derivatives");
    expect(prepared).not.toContain("#ifndef GL_OES_standard_derivatives");
  });

  it("can select the guarded bump-normal replacement for headset testing", () => {
    const prepared = prepareBrushShaderSource(
      `#ifndef GL_OES_standard_derivatives
vec3 PerturbNormal(vec3 position, vec3 normal, vec2 uv) { return normal; }
#else
uniform sampler2D u_BumpMap;
vec3 PerturbNormal(vec3 position, vec3 normal, vec2 uv) { return dFdx(position); }
#endif
void main() {}`,
      "guarded",
    );

    expect(prepared).toContain("uniform sampler2D u_BumpMap;");
    expect(prepared).toContain("safeDeterminant");
    expect(prepared).toContain("candidateLengthSquared");
    expect(prepared).toContain("gl_FrontFacing ? 1.0 : -1.0");
    expect(prepared).not.toContain("#ifndef GL_OES_standard_derivatives");
    expect(prepared).not.toContain("return dFdx(position);");
  });

  it("renames the hand-rolled inverse() (built-in in GLSL ES 3.00)", () => {
    const prepared = prepareBrushShaderSource(
      "mat4 inverse(mat4 m) { return m; }\n" +
        "void main() { vec4 p = inverse(modelViewMatrix) * vec4(1.0); float s = inversesqrt(4.0); }",
    );
    expect(prepared).toContain("mat4 tb_inverse(mat4 m)");
    expect(prepared).toContain("tb_inverse(modelViewMatrix)");
    expect(prepared).not.toMatch(/\binverse\s*\(/);
    // The genuine built-in inversesqrt is untouched.
    expect(prepared).toContain("inversesqrt(4.0)");
  });

  it("preserves the GLSL3 built-in inverse() without a custom definition", () => {
    const prepared = prepareBrushShaderSource(
      "void main() { vec4 p = inverse(modelViewMatrix) * vec4(1.0); }",
    );
    expect(prepared).toContain("inverse(modelViewMatrix)");
    expect(prepared).not.toContain("tb_inverse");
  });

  it("is idempotent", () => {
    const source = "uniform mat4 modelViewMatrix;\nvoid main() {}";
    const once = prepareBrushShaderSource(source);
    expect(prepareBrushShaderSource(once)).toBe(once);
  });
});

describe("stroke UV orientation for shader textures", () => {
  const stroke = createEmptyStrokeData({
    guid: "uv-test",
    brushGuid: LIGHT_GUID,
    brushSize: 0.1,
    brushScale: 1,
    color: [1, 0, 0, 1],
    layerIndex: 0,
    seed: 1,
    groupId: 1,
    controlPoints: [
      { position: [0, 1, 0], orientation: [0, 0, 0, 1], pressure: 1, timestampMs: 0 },
      { position: [0.2, 1, 0], orientation: [0, 0, 0, 1], pressure: 1, timestampMs: 16 },
      { position: [0.4, 1, 0], orientation: [0, 0, 0, 1], pressure: 1, timestampMs: 32 },
    ],
  });

  it("runs u along the ribbon length and v across the width", () => {
    const generated = generateBrushGeometry(stroke, "ribbon");
    // Vertex pairs (left,right) per control point: u = length fraction on both.
    // V is flipped to the glTF convention consumed by the exported shaders.
    expect(Array.from(generated.uvs.slice(0, 4))).toEqual([0, 1, 0, 0]);
    expect(Array.from(generated.uvs.slice(4, 8))).toEqual([0.5, 1, 0.5, 0]);
    expect(Array.from(generated.uvs.slice(8, 12))).toEqual([1, 1, 1, 0]);
  });

  it("runs u along the tube length and v around the ring", () => {
    const generated = generateBrushGeometry(stroke, "tube");
    const ringSides = 8;
    const ringVerts = ringSides + 1; // UV seam duplicate
    const initialU = generated.uvs[0];
    for (let ringIndex = 0; ringIndex < ringVerts; ringIndex += 1) {
      const offset = ringIndex * 2;
      expect(generated.uvs[offset]).toBe(initialU);
      expect(generated.uvs[offset + 1]).toBeCloseTo(1 - ringIndex / ringSides);
    }
    const lastRingOffset = 2 * ringVerts * 2;
    expect(generated.uvs[lastRingOffset] - initialU).toBeCloseTo(4 / Math.PI);
  });
});
