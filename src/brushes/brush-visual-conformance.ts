import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  Vector4,
  WebGLRenderer,
  WebGLRenderTarget,
} from "@iwsdk/core";
import type { Camera } from "@iwsdk/core";
import type { GeneratedBrushGeometry } from "./brush-geometry.js";

import {
  applyBrushShaderAttributeAliases,
  applyBrushShaderSupplementalAttributes,
  DANCE_FLOOR_BRUSH_GUID,
  LEAKY_PEN_BRUSH_GUID,
} from "./brush-shader-library.js";
import {
  applyBrushRenderGroups,
  createBrushRenderMaterial,
  ELECTRICITY_BRUSH_GUID,
  TOON_BRUSH_GUID,
  TUBE_TOON_INVERTED_BRUSH_GUID,
} from "./brush-render-material.js";
import {
  compareRgbPixels,
  type PixelDifference,
} from "./brush-pixel-difference.js";

export const BRUSH_VISUAL_CONFORMANCE_PREFIX = "[BrushVisualConformance]";
export const BRUSH_VISUAL_CONFORMANCE_SIZE = 256;
export const OPEN_BRUSH_SCREENSHOT_SIZE = 1024;

export interface BrushVisualConformanceResult extends PixelDifference {
  passed: boolean;
  bumpCoveredPixelRatio: number;
  flatCoveredPixelRatio: number;
  bumpPixels: Uint8Array;
  flatPixels: Uint8Array;
}

export interface BrushGeometryVisualConformanceResult {
  name: string;
  kind: string;
  passed: boolean;
  coveredPixelRatio: number;
  size: number;
  pixels: Uint8Array;
}

export function runBrushGeometryVisualConformance(
  renderer: WebGLRenderer,
  sourceMaterial: ShaderMaterial,
  generated: GeneratedBrushGeometry,
  name = "Smoke",
  kind = "particle",
  camera?: Camera,
  minimumCoveredPixelRatio = 0.005,
  renderSize = BRUSH_VISUAL_CONFORMANCE_SIZE,
): BrushGeometryVisualConformanceResult {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(generated.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(generated.normals, 3));
  geometry.setAttribute("tangent", new BufferAttribute(generated.tangents, 4));
  geometry.setAttribute("color", new BufferAttribute(generated.colors, 4));
  geometry.setAttribute("uv", new BufferAttribute(generated.uvs, 2));
  if (generated.packedUvs) {
    geometry.setAttribute(
      "a_texcoord0",
      new BufferAttribute(generated.packedUvs, generated.uv0Size),
    );
  }
  if (generated.uv1) {
    geometry.setAttribute(
      "uv1",
      new BufferAttribute(generated.uv1, generated.uv1Size),
    );
    geometry.setAttribute(
      "a_texcoord1",
      new BufferAttribute(generated.uv1, generated.uv1Size),
    );
  }
  geometry.setIndex(new BufferAttribute(generated.indices, 1));
  applyBrushShaderAttributeAliases(geometry);
  applyBrushShaderSupplementalAttributes(
    geometry,
    name === "DanceFloor"
      ? DANCE_FLOOR_BRUSH_GUID
      : name === "LeakyPen"
        ? LEAKY_PEN_BRUSH_GUID
        : "",
    generated.positions.length / 3,
  );

  const material = sourceMaterial.clone();
  const renderMaterial = createBrushRenderMaterial(
    name === "Electricity"
      ? ELECTRICITY_BRUSH_GUID
      : name === "Toon"
        ? TOON_BRUSH_GUID
        : name === "TubeToonInverted"
          ? TUBE_TOON_INVERTED_BRUSH_GUID
        : "",
    material,
  );
  applyBrushRenderGroups(geometry, generated.indices.length, renderMaterial);
  const mesh = new Mesh(geometry, renderMaterial);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const renderCamera = camera ?? createDefaultGeometryCamera();
  const target = new WebGLRenderTarget(
    renderSize,
    renderSize,
  );
  const pixels = new Uint8Array(renderSize ** 2 * 4);
  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = renderer.getClearColor(new Color());
  const previousClearAlpha = renderer.getClearAlpha();
  try {
    renderer.setClearColor(0x000000, 0);
    renderPixels(renderer, scene, renderCamera, target, pixels, renderSize);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    geometry.dispose();
    if (Array.isArray(renderMaterial)) {
      for (const pass of renderMaterial) {
        pass.dispose();
      }
      material.dispose();
    } else {
      renderMaterial.dispose();
    }
    target.dispose();
  }
  let coveredPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] + pixels[index + 1] + pixels[index + 2] > 3) {
      coveredPixels += 1;
    }
  }
  const coveredPixelRatio = coveredPixels / renderSize ** 2;
  return {
    name,
    kind,
    passed: coveredPixelRatio >= minimumCoveredPixelRatio,
    coveredPixelRatio,
    size: renderSize,
    pixels,
  };
}

export function createOpenBrushScreenshotCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);
  camera.updateMatrixWorld(true);
  return camera;
}

function createDefaultGeometryCamera(): OrthographicCamera {
  const camera = new OrthographicCamera(-0.3, 0.3, 0.3, -0.3, 0.1, 10);
  camera.position.z = 2;
  camera.updateMatrixWorld(true);
  return camera;
}

export function showBrushGeometryVisualConformance(
  result: BrushGeometryVisualConformanceResult,
): void {
  document.getElementById("brush-visual-conformance")?.remove();
  const root = document.createElement("section");
  root.id = "brush-visual-conformance";
  root.style.cssText =
    "position:fixed;inset:16px;z-index:10000;background:#111;color:#eee;padding:16px;font:14px system-ui;overflow:auto";
  const heading = document.createElement("h1");
  heading.textContent = `${result.name} ${result.kind} render: ${result.passed ? "PASS" : "FAIL"}`;
  const details = document.createElement("p");
  details.textContent = `covered ${(result.coveredPixelRatio * 100).toFixed(2)}%`;
  root.append(
    heading,
    details,
    createPixelFigure(
      `Generated ${result.name} stroke`,
      result.pixels,
      result.size,
    ),
  );
  root.dataset.result = result.passed ? "pass" : "fail";
  document.body.append(root);
}

/**
 * Renders the real Open Brush material against a control with only its
 * PerturbNormal call disabled. Geometry, textures, uniforms, camera and
 * lighting remain identical, so the pixel delta isolates bump mapping.
 */
export function runBumpVisualConformance(
  renderer: WebGLRenderer,
  sourceMaterial: ShaderMaterial,
): BrushVisualConformanceResult {
  const bumpMaterial = sourceMaterial.clone();
  const flatMaterial = sourceMaterial.clone();
  const normalCall = [
    "vec3 normal = PerturbNormal(v_tangent, v_bitangent, v_normal, v_texcoord0);",
    "vec3 normal = PerturbNormal(v_position.xyz, normalize(v_normal), v_texcoord0);",
  ].find((candidate) => flatMaterial.fragmentShader.includes(candidate));
  if (!normalCall) {
    bumpMaterial.dispose();
    flatMaterial.dispose();
    throw new Error("Open Brush shader no longer contains the expected bump-normal call.");
  }
  flatMaterial.fragmentShader = flatMaterial.fragmentShader.replace(
    normalCall,
    "vec3 normal = normalize(v_normal);",
  );
  flatMaterial.needsUpdate = true;
  applyConformanceLighting(bumpMaterial);
  applyConformanceLighting(flatMaterial);

  const geometry = createConformanceQuad();
  const mesh = new Mesh(geometry, bumpMaterial);
  mesh.scale.setScalar(0.05);
  mesh.frustumCulled = false;
  const scene = new Scene();
  scene.add(mesh);
  const camera = new OrthographicCamera(-0.05, 0.05, 0.05, -0.05, 0.1, 10);
  camera.position.z = 2;
  camera.updateMatrixWorld(true);

  const target = new WebGLRenderTarget(
    BRUSH_VISUAL_CONFORMANCE_SIZE,
    BRUSH_VISUAL_CONFORMANCE_SIZE,
  );
  const bumpPixels = new Uint8Array(BRUSH_VISUAL_CONFORMANCE_SIZE ** 2 * 4);
  const flatPixels = new Uint8Array(BRUSH_VISUAL_CONFORMANCE_SIZE ** 2 * 4);
  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = renderer.getClearColor(new Color());
  const previousClearAlpha = renderer.getClearAlpha();
  try {
    renderer.setClearColor(0x000000, 0);
    renderPixels(renderer, scene, camera, target, bumpPixels);
    mesh.material = flatMaterial;
    renderPixels(renderer, scene, camera, target, flatPixels);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClearColor, previousClearAlpha);
    geometry.dispose();
    bumpMaterial.dispose();
    flatMaterial.dispose();
    target.dispose();
  }

  const difference = compareRgbPixels(bumpPixels, flatPixels);
  const bumpCoveredPixelRatio = coloredPixelRatio(bumpPixels);
  const flatCoveredPixelRatio = coloredPixelRatio(flatPixels);
  return {
    ...difference,
    // Both coverage and magnitude matter: this rejects a few unstable edge
    // pixels while catching the former all-flat PerturbNormal fallback.
    passed:
      difference.changedPixelRatio >= 0.05 &&
      difference.rootMeanSquareDifference >= 1 &&
      bumpCoveredPixelRatio >= 0.05 &&
      flatCoveredPixelRatio >= 0.05,
    bumpCoveredPixelRatio,
    flatCoveredPixelRatio,
    bumpPixels,
    flatPixels,
  };
}

function applyConformanceLighting(material: ShaderMaterial): void {
  // A fixed grazing light makes the real 0.0015 Oil Paint displacement
  // observable without changing its shader strength or texture sampling.
  material.uniforms.u_SceneLight_0_matrix.value = new Matrix4().makeRotationY(
    Math.PI / 3,
  );
  material.uniforms.u_SceneLight_0_color.value = new Vector4(1.5, 1.5, 1.5, 1);
  material.uniforms.u_SceneLight_1_color.value = new Vector4(0, 0, 0, 1);
  material.uniforms.u_ambient_light_color.value = new Vector4(0.03, 0.03, 0.03, 1);
}

export function showBumpVisualConformance(
  result: BrushVisualConformanceResult,
  brushName = "Oil Paint",
): void {
  document.getElementById("brush-visual-conformance")?.remove();
  const root = document.createElement("section");
  root.id = "brush-visual-conformance";
  root.style.cssText =
    "position:fixed;inset:16px;z-index:10000;background:#111;color:#eee;padding:16px;font:14px system-ui;overflow:auto";
  const heading = document.createElement("h1");
  heading.textContent = `${brushName} bump A/B: ${result.passed ? "PASS" : "FAIL"}`;
  root.append(heading);
  const details = document.createElement("p");
  details.textContent = `bump coverage ${(result.bumpCoveredPixelRatio * 100).toFixed(2)}% · flat coverage ${(result.flatCoveredPixelRatio * 100).toFixed(2)}% · changed ${(result.changedPixelRatio * 100).toFixed(2)}% · RMS ${result.rootMeanSquareDifference.toFixed(2)} · mean ${result.meanAbsoluteDifference.toFixed(2)}`;
  root.append(details);
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:16px;flex-wrap:wrap";
  row.append(
    createPixelFigure("Bump mapping enabled", result.bumpPixels),
    createPixelFigure("Flat-normal control", result.flatPixels),
  );
  root.append(row);
  root.dataset.result = result.passed ? "pass" : "fail";
  document.body.append(root);
}

function createConformanceQuad(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3),
  );
  geometry.setAttribute(
    "normal",
    new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3),
  );
  geometry.setAttribute(
    "tangent",
    new BufferAttribute(new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]), 4),
  );
  geometry.setAttribute(
    "color",
    new BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]), 4),
  );
  geometry.setAttribute(
    "uv",
    new BufferAttribute(new Float32Array([0, 0, 4, 0, 4, 4, 0, 4]), 2),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  applyBrushShaderAttributeAliases(geometry);
  return geometry;
}

function coloredPixelRatio(pixels: Uint8Array): number {
  let covered = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    covered += Number(pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > 3);
  }
  return covered / (pixels.length / 4);
}

function renderPixels(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  target: WebGLRenderTarget,
  pixels: Uint8Array,
  size = BRUSH_VISUAL_CONFORMANCE_SIZE,
): void {
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(
    target,
    0,
    0,
    size,
    size,
    pixels,
  );
}

function createPixelFigure(
  label: string,
  pixels: Uint8Array,
  size = BRUSH_VISUAL_CONFORMANCE_SIZE,
): HTMLElement {
  const figure = document.createElement("figure");
  const canvas = document.createElement("canvas");
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  canvas.width = size;
  canvas.height = size;
  canvas.style.cssText = `width:${size}px;max-width:100%;image-rendering:auto;background:#000`;
  const context = canvas.getContext("2d");
  if (context) {
    const flipped = new Uint8ClampedArray(pixels.length);
    const rowBytes = size * 4;
    for (let y = 0; y < size; y += 1) {
      const sourceOffset = y * rowBytes;
      const targetOffset = (size - y - 1) * rowBytes;
      flipped.set(pixels.subarray(sourceOffset, sourceOffset + rowBytes), targetOffset);
    }
    context.putImageData(
      new ImageData(flipped, size, size),
      0,
      0,
    );
  }
  const caption = document.createElement("figcaption");
  caption.textContent = label;
  figure.append(canvas, caption);
  return figure;
}
