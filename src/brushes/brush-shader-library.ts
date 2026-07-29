import {
  AddEquation,
  AssetManager,
  BufferAttribute,
  BufferGeometry,
  Camera,
  CustomBlending,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  NormalBlending,
  OneFactor,
  ShaderMaterial,
  Scene,
  Texture,
  Vector3,
  Vector4,
  WebGLRenderer,
} from "@iwsdk/core";
import { TiltShaderLoader } from "three-icosa";

import type { BrushInventoryEntry } from "./brush-inventory.js";
import { resolveBrushAssetBaseUrl } from "./brush-asset-base-url.js";
import { copyUv1BirthTimes } from "./brush-shader-attributes.js";
import {
  openBrushShaderCompatibility,
  type BrushShaderCompatibilityContext,
} from "./brush-shader-compatibility.js";
import {
  createBrushShaderMaterialDescriptor,
  prepareBrushShaderSource,
  resolveLoadedTextureTexelSize,
  OPENBRUSH_AMBIENT_LIGHT_COLOR,
  OPENBRUSH_FOG_COLOR,
  OPENBRUSH_SCENE_LIGHT_0_COLOR,
  OPENBRUSH_SCENE_LIGHT_0_MATRIX,
  OPENBRUSH_SCENE_LIGHT_1_COLOR,
  OPENBRUSH_SCENE_LIGHT_1_MATRIX,
  OPENBRUSH_USES_NEW_TILT_EXPORTER,
  type BrushShaderMaterialDescriptor,
  type BrushBumpMappingMode,
} from "./brush-shader-materials.js";
import { createIwsdkTiltMaterial } from "./iwsdk-tilt-material.js";
import { applyBrushTextureImporterSettings } from "./brush-texture-settings.js";

const AUTHORITATIVE_BRUSH_ASSET_URL = resolveBrushAssetBaseUrl();
const AUTHORITATIVE_MATERIAL_GUIDS = new Set([
  "f72ec0e7-a844-4e38-82e3-140c44772699", // Oil Paint
  "f5c336cf-5108-4b40-ade9-c687504385ab", // Ink
  "75b32cf0-fdd6-4d89-a64b-e2a00b247b0f", // Thick Paint
  "b67c0e81-ce6d-40a8-aeb0-ef036b081aa3", // Wet Paint
  "d0262945-853c-4481-9cbd-88586bed93cb", // Duct Tape
  "f1114e2e-eb8d-4fde-915a-6e653b54e9f5", // Paper
  "dce872c2-7b49-4684-b59b-c45387949c5c", // Hypercolor
  "429ed64a-4e97-4466-84d3-145a861ef684", // Marker
  "d90c6ad8-af0f-4b54-b422-e0f92abe1b3c", // Tapered Marker
  "cf019139-d41c-4eb0-a1d0-5cf54b0a42f3", // Highlighter
  "2d35bcf0-e4d8-452c-97b1-3311be063130", // Flat
  "b468c1fb-f254-41ed-8ec9-57030bc5660c", // Tapered Flat
  "accb32f5-4509-454f-93f8-1df3fd31df1b", // Soft Highlighter
  "2241cd32-8ba2-48a5-9ee7-2caef7e9ed62", // Light
  "30cb9af6-be41-4872-8f3e-cbff63fe3db8", // Digital
  "abfbb2aa-70b4-4a5c-8126-8eedda2b3628", // Race
  "cb92b597-94ca-4255-b017-0e3f42f12f9e", // Fire
  "ad1ad437-76e2-450d-a23a-e17f8310b960", // Rainbow
  "d229d335-c334-495a-a801-660ac8a87360", // Velvet Ink
  "10201aa3-ebc2-42d8-84b7-2e63f6eeb8ab", // Waveform
  "5347acf0-a8e2-47b6-8346-30c70719d763", // Wiggly Graphite
  "44bb800a-fbc3-4592-8426-94ecb05ddec3", // Streamers
  "700f3aa8-9a7c-2384-8b8a-ea028905dd8c", // Cel Vinyl
  "8dc4a70c-d558-4efd-a5ed-d4e860f40dc3", // Splatter
  "1161af82-50cf-47db-9706-0c3576d43c43", // Coarse Bristles
  "02ffb866-7fb2-4d15-b761-1012cefb1360", // Embers
  "70d79cca-b159-4f35-990c-f02193947fe8", // Smoke
  "d902ed8b-d0d1-476c-a8de-878a79e3a34c", // Snow
  "0eb4db27-3f82-408d-b5a1-19ebd7d5b711", // Stars
  "89d104cd-d012-426b-b5b3-bbaee63ac43c", // Bubbles
  "6a1cf9f9-032c-45ec-9b1d-a6680bee30f7", // Dots
  "0d3889f3-3ede-470c-8af4-de4813306126", // Double Tapered Marker
  "0d3889f3-3ede-470c-8af4-f44813306126", // Double Tapered Flat
  "f6e85de3-6dcc-4e7f-87fd-cee8c3d25d51", // Electricity
  "b2ffef01-eaaa-4ab5-aa64-95a2c4f5dbc6", // Neon Pulse
  "4391aaaa-df81-4396-9e33-31e4e4930b27", // Light Wire
  "0f0ff7b2-a677-45eb-a7d6-0cd7206f4816", // Chromatic Wave
  "4391385a-df73-4396-9e33-31e4e4930b27", // Toon
  "4391385a-cf83-4396-9e33-31e4e4930b27", // Wire
  "cf7f0059-7aeb-53a4-2b67-c83d863a9ffa", // Spikes
  "4391aaaa-df73-4396-9e33-31e4e4930b27", // Disco
  "2f212815-f4d3-c1a4-681a-feeaf9c6dc37", // Icing
  "1caa6d7d-f015-3f54-3a4b-8b5354d39f81", // Comet
  "faaa4d44-fcfb-4177-96be-753ac0421ba3", // Shiny Hull
  "79348357-432d-4746-8e29-0e25c112e3aa", // Matte Hull
  "a8fea537-da7c-4d4b-817f-24f074725d6d", // Unlit Hull
  "c8313697-2563-47fc-832e-290f4c04b901", // Diamond Hull
  "6a1cf9f9-032c-45ec-9b6e-a6680bee32e9", // HyperGrid
  "e0abbc80-0f80-e854-4970-8924a0863dcc", // Petal
  "d381e0f5-3def-4a0d-8853-31e9200bcbda", // Lofted
  "d3f3b18a-da03-f694-b838-28ba8e749a98", // 3D Printing Brush
  "1b897b7e-9b76-425a-b031-a867c48df409", // Gouache
  "8e58ceea-7830-49b4-aba9-6215104ab52a", // Mylar Tube
  "03a529e1-f519-3dd4-582d-2d5cd92c3f4f", // Rain
  "725f4c6a-6427-6524-29ab-da371924adab", // Dry Brush
  "ddda8745-4bb5-ac54-88b6-d1480370583e", // Leaky Pen
  "50e99447-3861-05f4-697d-a1b96e771b98", // Sparks
  "7136a729-1aab-bd24-f8b2-ca88b6adfb67", // Wind
  "a8147ce1-005e-abe4-88e8-09a1eaadcc89", // Rising Bubbles
  "9568870f-8594-60f4-1b20-dfbc8a5eac0e", // Tapered Wire
  "2e03b1bf-3ebd-4609-9d7e-f4cafadc4dfa", // Square Paper
  "39ee7377-7a9e-47a7-a0f8-0c77712f75d3", // Thick Geometry
  "2c1a6a63-6552-4d23-86d7-58f6fba8581b", // Wireframe
  "f28c395c-a57d-464b-8f0b-558c59478fa3", // Muscle
  "99aafe96-1645-44cd-99bd-979bc6ef37c5", // Guts
  "53d753ef-083c-45e1-98e7-4459b4471219", // Fire 2
  "9871385a-df73-4396-9e33-31e4e4930b27", // Tube Toon Inverted
  "d1d991f2-e7a0-4cf1-b328-f57e915e6260", // Dot Marker
  "4391ffaa-df73-4396-9e33-31e4e4930b27", // Faceted Tube
  "1a26b8c0-8a07-4f8a-9fac-d2ef36e0cad0", // Tapered Marker Flat
  "c33714d1-b2f9-412e-bd50-1884c9d46336", // Plasma
  "f0a2298a-be80-432c-9fee-a86dcc06f4f9", // SingleSided
  "6a1cf9f9-032c-45ec-9b6e-a6680bee30f7", // Waveform Particles
  "eba3f993-f9a1-4d35-b84e-bb08f48981a4", // Bubble Wand
  "6a1cf9f9-032c-45ec-311e-a6680bee32e9", // Dance Floor
  "0f5820df-cb6b-4a6c-960e-56e4c8000eda", // Waveform Tube
  "492b36ff-b337-436a-ba5f-1e87ee86747e", // Drafting
  "c1c9b26d-673a-4dc6-b373-51715654ab96", // Tube Additive
  "a555b809-2017-46cb-ac26-e63173d8f45e", // Feather
  "84d5bbb2-6634-8434-f8a7-681b576b4664", // Duct Tape Geometry
  "3d9755da-56c7-7294-9b1d-5ec349975f52", // Tapered Hue Shift
  "1cf94f63-f57a-4a1a-ad14-295af4f5ab5c", // Lacewing
  "c86c058d-1bda-2e94-08db-f3d6a96ac4a1", // Marbled Rainbow
  "fde6e778-0f7a-e584-38d6-89d44cee59f6", // Charcoal
  "f8ba3d18-01fc-4d7b-b2d9-b99d10b8e7cf", // Keijiro Tube
  "c5da2e70-a6e4-63a4-898c-5cfedef09c97", // Lofted Hue Shift
  "62fef968-e842-3224-4a0e-1fdb7cfb745c", // Wire Lit
  "d120944d-772f-4062-99c6-46a6f219eeaf", // Waveform FFT
  "d9cc5e99-ace1-4d12-96e0-4a7c18c99cfc", // Fairy
  "bdf65db2-1fb7-4202-b5e0-c6b5e3ea851e", // Space
  "355b3579-bf1d-4ff5-a200-704437fe684b", // Smooth Hull
  "7259cce5-41c1-ec74-c885-78af28a31d95", // Leaves 2
  "7c972c27-d3c2-8af4-7bf8-5d9db8f0b7bb", // Ink Geometry
  "f4a0550c-332a-4e1a-9793-b71508f4a454", // Double Flat
  "7ae1f880-a517-44a0-99f9-1cab654498c6", // Concave Hull
]);

interface UniformHolder {
  value: unknown;
}

function resolveRequestedBumpMappingMode(): BrushBumpMappingMode {
  if (typeof window === "undefined") {
    return "guarded";
  }
  return new URLSearchParams(window.location.search).get("bump-mapping") ===
    "fallback"
    ? "fallback"
    : "guarded";
}

/**
 * Loads and caches one ShaderMaterial per brush GUID from the extracted
 * Open Brush GLSL exports. Materials are shared across strokes; per-frame
 * state (time, camera-space light matrices) lives in uniform holder objects
 * shared by reference across all materials, so one update reaches everything.
 */
export class BrushShaderLibrary {
  private readonly materials = new Map<string, ShaderMaterial>();
  private readonly bakedMaterials = new Map<string, ShaderMaterial>();
  private readonly pending = new Map<string, Promise<ShaderMaterial | undefined>>();
  private readonly materialLoadedListeners = new Set<
    (guid: string, material: ShaderMaterial) => void
  >();
  private readonly lightWorld0 = new Matrix4().fromArray(OPENBRUSH_SCENE_LIGHT_0_MATRIX);
  private readonly lightWorld1 = new Matrix4().fromArray(OPENBRUSH_SCENE_LIGHT_1_MATRIX);
  private readonly viewMatrix = new Matrix4();
  private readonly tiltShaderLoader = new TiltShaderLoader(undefined, {
    materialFactory: createIwsdkTiltMaterial,
  }).setPath(AUTHORITATIVE_BRUSH_ASSET_URL);

  readonly frameUniforms = {
    // Generated stroke geometry uses Open Brush's original packed vertex
    // layout. The newer-exporter branches require additional baked UV data.
    u_isNewTiltExporter: { value: OPENBRUSH_USES_NEW_TILT_EXPORTER },
    u_time: { value: new Vector4(0, 0, 0, 0) },
    u_SceneLight_0_matrix: {
      value: new Matrix4().fromArray(OPENBRUSH_SCENE_LIGHT_0_MATRIX),
    },
    u_SceneLight_1_matrix: {
      value: new Matrix4().fromArray(OPENBRUSH_SCENE_LIGHT_1_MATRIX),
    },
    u_SceneLight_0_color: {
      value: new Vector4().fromArray(OPENBRUSH_SCENE_LIGHT_0_COLOR as number[]),
    },
    u_SceneLight_1_color: {
      value: new Vector4().fromArray(OPENBRUSH_SCENE_LIGHT_1_COLOR as number[]),
    },
    u_ambient_light_color: {
      value: new Vector4().fromArray(OPENBRUSH_AMBIENT_LIGHT_COLOR as number[]),
    },
    u_fogColor: { value: new Vector3().fromArray(OPENBRUSH_FOG_COLOR as number[]) },
    // ENVIRONMENT_STANDARD fog. ApplyFog multiplies by 10 internally, so this
    // lands at the same 0.0025/m the environment meshes use.
    u_fogDensity: { value: 0.00025 },
  };

  get(guid: string): ShaderMaterial | undefined {
    return this.materials.get(guid);
  }

  isManaged(material: unknown): boolean {
    for (const managed of this.materials.values()) {
      if (managed === material) {
        return true;
      }
    }
    return false;
  }

  subscribeMaterialLoaded(
    listener: (guid: string, material: ShaderMaterial) => void,
  ): () => void {
    this.materialLoadedListeners.add(listener);
    return () => this.materialLoadedListeners.delete(listener);
  }

  async load(
    entry: BrushInventoryEntry,
    options?: { allowAnyGeometry?: boolean },
  ): Promise<ShaderMaterial | undefined> {
    const allowAnyGeometry = options?.allowAnyGeometry === true;
    const targetMaterials = allowAnyGeometry
      ? this.bakedMaterials
      : this.materials;
    const cached = targetMaterials.get(entry.guid);
    if (cached) {
      return cached;
    }
    const pendingKey = `${allowAnyGeometry ? "baked" : "generated"}:${entry.guid}`;
    let promise = this.pending.get(pendingKey);
    if (!promise) {
      promise = this.createMaterial(entry, options, targetMaterials);
      this.pending.set(pendingKey, promise);
    }
    return promise;
  }

  /** Advance shared per-frame uniforms. Call once per frame before rendering. */
  updateFrame(timeSeconds: number, camera: Camera): void {
    // Same packing as packBrushShaderTime (Unity _Time), written in place so
    // the per-frame call allocates nothing.
    (this.frameUniforms.u_time.value as Vector4).set(
      timeSeconds / 20,
      timeSeconds,
      timeSeconds * 2,
      timeSeconds * 3,
    );
    this.viewMatrix.copy(camera.matrixWorld).invert();
    (this.frameUniforms.u_SceneLight_0_matrix.value as Matrix4).multiplyMatrices(
      this.viewMatrix,
      this.lightWorld0,
    );
    (this.frameUniforms.u_SceneLight_1_matrix.value as Matrix4).multiplyMatrices(
      this.viewMatrix,
      this.lightWorld1,
    );
  }

  /**
   * Pre-compile all cached materials so the first stroke of each brush does
   * not hitch. Uses KHR_parallel_shader_compile when available.
   */
  async warmUp(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    context: BrushShaderCompatibilityContext = renderer.xr.isPresenting
      ? "immersive-xr"
      : "browser",
  ): Promise<number> {
    const group = new Group();
    for (const [guid, material] of this.materials) {
      const mesh = new Mesh(createWarmupGeometry(guid), material);
      mesh.frustumCulled = false;
      group.add(mesh);
    }
    if (group.children.length === 0) {
      return 0;
    }
    try {
      // compileAsync needs KHR_parallel_shader_compile; probe silently to
      // avoid three's "extension not supported" warning and compile sync.
      const supportsParallelCompile = renderer
        .getContext()
        .getSupportedExtensions()
        ?.includes("KHR_parallel_shader_compile");
      if (supportsParallelCompile) {
        await renderer.compileAsync(group, camera, scene);
      } else {
        renderer.compile(group, camera, scene);
      }
      const rendererName = resolveRendererName(renderer);
      for (const [guid, material] of this.materials) {
        const failure = getMaterialCompileFailure(renderer, material);
        openBrushShaderCompatibility.record({
          guid,
          name: material.name.replace(/^OpenBrushShader_/, ""),
          context,
          status: failure ? "compile-failed" : "ready",
          renderer: rendererName,
          message: failure,
        });
      }
    } catch (error) {
      console.warn("OpenBrush shader warmup failed:", error);
      const message = toErrorMessage(error);
      const rendererName = resolveRendererName(renderer);
      for (const [guid, material] of this.materials) {
        openBrushShaderCompatibility.record({
          guid,
          name: material.name.replace(/^OpenBrushShader_/, ""),
          context,
          status: "compile-failed",
          renderer: rendererName,
          message,
        });
      }
    }
    for (const child of [...group.children]) {
      (child as Mesh).geometry.dispose();
      group.remove(child);
    }
    return this.materials.size;
  }

  private async createMaterial(
    entry: BrushInventoryEntry,
    options?: { allowAnyGeometry?: boolean },
    targetMaterials: Map<string, ShaderMaterial> = this.materials,
  ): Promise<ShaderMaterial | undefined> {
    if (AUTHORITATIVE_MATERIAL_GUIDS.has(entry.guid)) {
      return this.createAuthoritativeMaterial(entry, targetMaterials);
    }
    const descriptor = createBrushShaderMaterialDescriptor(entry, options);
    if (!descriptor) {
      return undefined;
    }
    try {
      const [vertexShader, fragmentShader, textures] = await Promise.all([
        fetchShaderSource(descriptor.vertexUrl),
        fetchShaderSource(descriptor.fragmentUrl),
        loadBrushTextures(descriptor),
      ]);
      // Non-raw ShaderMaterial is required for XR: super-three only applies
      // its GLSL3 conversion and OVR_multiview patching to non-raw programs.
      const material = new ShaderMaterial({
        name: `OpenBrushShader_${descriptor.name}`,
        vertexShader: prepareBrushShaderSource(
          vertexShader,
          resolveRequestedBumpMappingMode(),
        ),
        fragmentShader: prepareBrushShaderSource(
          fragmentShader,
          resolveRequestedBumpMappingMode(),
        ),
        uniforms: this.buildUniforms(descriptor, textures),
        transparent: descriptor.transparent,
        depthWrite: descriptor.depthWrite,
        side: descriptor.doubleSided ? DoubleSide : FrontSide,
      });
      material.index0AttributeName = "a_position";
      if (descriptor.blending === "additive") {
        // Match the Unity brush shaders' "Blend One One": the fragment stage
        // already premultiplies by the brush mask.
        material.blending = CustomBlending;
        material.blendEquation = AddEquation;
        material.blendSrc = OneFactor;
        material.blendDst = OneFactor;
      } else if (descriptor.blending === "alpha") {
        material.blending = NormalBlending;
      }
      targetMaterials.set(entry.guid, material);
      if (targetMaterials === this.materials) {
        for (const listener of this.materialLoadedListeners) {
          try {
            listener(entry.guid, material);
          } catch (error) {
            console.warn(
              `[BrushMaterialUpgrade] listener failed for ${entry.guid}:`,
              error,
            );
          }
        }
      }
      openBrushShaderCompatibility.record({
        guid: entry.guid,
        name: entry.name,
        context: "asset-load",
        status: "ready",
      });
      return material;
    } catch (error) {
      console.warn(
        `OpenBrush shader material for ${descriptor.name} (${entry.guid}) failed to load; using fallback material.`,
        error,
      );
      openBrushShaderCompatibility.record({
        guid: entry.guid,
        name: entry.name,
        context: "asset-load",
        status: "load-failed",
        message: toErrorMessage(error),
      });
      return undefined;
    }
  }

  private async createAuthoritativeMaterial(
    entry: BrushInventoryEntry,
    targetMaterials: Map<string, ShaderMaterial>,
  ): Promise<ShaderMaterial | undefined> {
    try {
      let material: ShaderMaterial | undefined;
      await this.tiltShaderLoader.load(
        entry.name,
        (loaded: ShaderMaterial) => {
          material = loaded;
        },
        undefined,
        undefined,
      );
      if (!material) {
        throw new Error(`three-icosa has no material binding for ${entry.name}`);
      }
      for (const [name, holder] of Object.entries(this.frameUniforms)) {
        material.uniforms[name] = holder;
      }
      targetMaterials.set(entry.guid, material);
      if (targetMaterials === this.materials) {
        for (const listener of this.materialLoadedListeners) {
          listener(entry.guid, material);
        }
      }
      openBrushShaderCompatibility.record({
        guid: entry.guid,
        name: entry.name,
        context: "asset-load",
        status: "ready",
      });
      return material;
    } catch (error) {
      console.warn(
        `Authoritative OpenBrush material for ${entry.name} (${entry.guid}) failed to load; using fallback material.`,
        error,
      );
      openBrushShaderCompatibility.record({
        guid: entry.guid,
        name: entry.name,
        context: "asset-load",
        status: "load-failed",
        message: toErrorMessage(error),
      });
      return undefined;
    }
  }

  private buildUniforms(
    descriptor: BrushShaderMaterialDescriptor,
    textures: Map<string, Texture>,
  ): Record<string, UniformHolder> {
    const uniforms: Record<string, UniformHolder> = {};
    for (const [name, value] of Object.entries(descriptor.uniforms)) {
      uniforms[name] =
        typeof value === "number"
          ? { value }
          : { value: new Vector4(value[0], value[1], value[2], value[3]) };
    }
    for (const [name, texture] of textures) {
      uniforms[name] = { value: texture };
      const texelSize = resolveLoadedTextureTexelSize(texture.image);
      if (texelSize) {
        uniforms[`${name}_TexelSize`] = { value: new Vector4(...texelSize) };
      }
    }
    // Shared holders are assigned by reference so a single updateFrame()
    // reaches every material; unused uniforms are ignored at upload time.
    for (const [name, holder] of Object.entries(this.frameUniforms)) {
      uniforms[name] = holder;
    }
    return uniforms;
  }
}

interface WebGLProgramDiagnostics {
  runnable: boolean;
  programLog: string;
  vertexShader?: { log?: string };
  fragmentShader?: { log?: string };
}

interface InspectableWebGLProgram {
  program?: WebGLProgram;
  diagnostics?: WebGLProgramDiagnostics;
  getAttributes?: () => unknown;
}

function getMaterialCompileFailure(
  renderer: WebGLRenderer,
  material: ShaderMaterial,
): string | undefined {
  const properties = renderer.properties.get(material) as {
    programs?: Map<unknown, InspectableWebGLProgram>;
  };
  const programs = properties.programs;
  if (!programs || programs.size === 0) {
    return "No WebGL program was produced during shader warmup.";
  }
  const gl = renderer.getContext();
  for (const program of programs.values()) {
    program.getAttributes?.();
    const linked = program.program
      ? Boolean(gl.getProgramParameter(program.program, gl.LINK_STATUS))
      : program.diagnostics?.runnable !== false;
    if (!linked || program.diagnostics?.runnable === false) {
      const diagnostics = program.diagnostics;
      return [
        diagnostics?.programLog,
        diagnostics?.vertexShader?.log,
        diagnostics?.fragmentShader?.log,
      ]
        .filter(Boolean)
        .join("\n") || "WebGL shader program failed to link.";
    }
  }
  return undefined;
}

function resolveRendererName(renderer: WebGLRenderer): string {
  try {
    const gl = renderer.getContext();
    return String(gl.getParameter(gl.RENDERER) ?? "unknown");
  } catch {
    return "unknown";
  }
}

function toErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4000);
}

async function fetchShaderSource(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch shader ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

async function loadBrushTextures(
  descriptor: BrushShaderMaterialDescriptor,
): Promise<Map<string, Texture>> {
  const loaded = await Promise.all(
    descriptor.textures.map(async ({ uniform, url, importer }) => {
      const texture = await AssetManager.loadTexture(url);
      texture.flipY = false;
      applyBrushTextureImporterSettings(texture, importer);
      return [uniform, texture] as const;
    }),
  );
  return new Map(loaded);
}

/**
 * Registers the GLSL attribute names used by the Open Brush shaders as
 * aliases of the standard three.js attributes. The same BufferAttribute
 * object is registered under both names, so there is a single GPU buffer;
 * a_position is declared vec4 in GLSL against an itemSize-3 buffer, which is
 * legal GL (w defaults to 1).
 */
export function applyBrushShaderAttributeAliases(geometry: BufferGeometry): void {
  const aliases: ReadonlyArray<[string, string]> = [
    ["position", "a_position"],
    ["normal", "a_normal"],
    ["tangent", "a_tangent"],
    ["color", "a_color"],
    ["uv", "a_texcoord0"],
    ["uv1", "a_texcoord1"],
  ];
  for (const [standardName, glslName] of aliases) {
    const attribute = geometry.getAttribute(standardName);
    if (attribute && geometry.getAttribute(glslName) !== attribute) {
      geometry.setAttribute(glslName, attribute);
    }
  }
}

export const DANCE_FLOOR_BRUSH_GUID =
  "6a1cf9f9-032c-45ec-311e-a6680bee32e9";
export const LEAKY_PEN_BRUSH_GUID =
  "ddda8745-4bb5-ac54-88b6-d1480370583e";

/**
 * Supplies shader attributes that are exported separately from the standard
 * mesh channels. Dance Floor's live generator stores particle birth time in
 * uv1.w; three-icosa binds the corresponding exported timestamp as a scalar.
 */
export function applyBrushShaderSupplementalAttributes(
  geometry: BufferGeometry,
  brushGuid: string,
  usedVertexCount?: number,
): BufferAttribute | undefined {
  const normalizedGuid = brushGuid.toLowerCase();
  if (normalizedGuid === LEAKY_PEN_BRUSH_GUID) {
    const uv0 = geometry.getAttribute("a_texcoord0");
    if (uv0) {
      geometry.setAttribute("a_texcoord1", uv0);
      return uv0 as BufferAttribute;
    }
    geometry.deleteAttribute("a_texcoord1");
    return undefined;
  }
  if (normalizedGuid !== DANCE_FLOOR_BRUSH_GUID) {
    return undefined;
  }
  const uv1 = geometry.getAttribute("a_texcoord1");
  if (!uv1 || uv1.itemSize < 4) {
    geometry.deleteAttribute("a_timestamp");
    return undefined;
  }
  const count = Math.min(usedVertexCount ?? uv1.count, uv1.count);
  let timestamp = geometry.getAttribute("a_timestamp") as
    | BufferAttribute
    | undefined;
  if (!timestamp || timestamp.itemSize !== 1 || timestamp.count !== uv1.count) {
    timestamp = new BufferAttribute(new Float32Array(uv1.count), 1);
    geometry.setAttribute("a_timestamp", timestamp);
  }
  const values = timestamp.array as Float32Array;
  copyUv1BirthTimes(uv1.array, uv1.itemSize, values, count);
  timestamp.clearUpdateRanges();
  timestamp.addUpdateRange(0, count);
  timestamp.needsUpdate = true;
  return timestamp;
}

function createWarmupGeometry(brushGuid: string): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(9), 3));
  geometry.setAttribute("tangent", new BufferAttribute(new Float32Array(12), 4));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(12), 4));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(6), 2));
  geometry.setAttribute("uv1", new BufferAttribute(new Float32Array(12), 4));
  geometry.setIndex(new BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  applyBrushShaderAttributeAliases(geometry);
  applyBrushShaderSupplementalAttributes(geometry, brushGuid);
  return geometry;
}

/** Shared library instance used by the stroke rendering systems. */
export const openBrushShaderLibrary = new BrushShaderLibrary();
