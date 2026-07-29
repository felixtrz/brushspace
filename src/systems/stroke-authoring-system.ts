import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PanelUI,
  Quaternion,
  Transform,
  Vector3,
  VisibilityState,
  createSystem,
} from "@iwsdk/core";
import type { Entity, Material, Texture } from "@iwsdk/core";

import {
  BrushPointer,
  BrushSettings,
  BrushStroke,
  CanvasLayer,
  InputCommandState,
  OpenBrushAppState,
  OpenBrushEraserCursor,
  OpenBrushCustomPanel,
  OpenBrushPanelAttachment,
  OpenBrushScenePose,
  OpenBrushTipAnchor,
  SettingsState,
  StrokeHistoryState,
} from "../components/core.js";
import { initialLoad } from "../app/initial-load.js";
import { openBrushInventory } from "../brushes/brush-catalog.js";
import {
  findBrushByGuid,
  type BrushGeometryParams,
  type BrushGeometryFamily,
  type BrushInventoryEntry,
  type BrushPressureOpacityRange,
  type BrushPressureSizeRange,
} from "../brushes/brush-inventory.js";
import {
  createBrushGeometryArrays,
  generateBrushGeometry,
  generateBrushGeometryInto,
  type BrushGeometryArrays,
} from "../brushes/brush-geometry.js";
import {
  createBrushMaterialSpec,
  type BrushMaterialSpec,
} from "../brushes/brush-materials.js";
import {
  applyBrushShaderAttributeAliases,
  applyBrushShaderSupplementalAttributes,
  openBrushShaderLibrary,
} from "../brushes/brush-shader-library.js";
import {
  BRUSH_VISUAL_CONFORMANCE_PREFIX,
  createOpenBrushScreenshotCamera,
  OPEN_BRUSH_SCREENSHOT_SIZE,
  runBumpVisualConformance,
  runBrushGeometryVisualConformance,
  showBumpVisualConformance,
  showBrushGeometryVisualConformance,
} from "../brushes/brush-visual-conformance.js";
import {
  createOpenBrushScreenshotControlPoints,
  OPEN_BRUSH_SCREENSHOT_SHADER_TIME_SECONDS,
} from "../brushes/brush-conformance-fixtures.js";
import { openBrushShaderCompatibility } from "../brushes/brush-shader-compatibility.js";
import { matchesBrushTextureImporterSettings } from "../brushes/brush-texture-settings.js";
import {
  hasBrushMainTextureCutout,
  hasTubeToonInvertedPassContract,
} from "../brushes/brush-shader-materials.js";
import {
  applyBrushRenderGroups,
  createBrushRenderMaterial,
} from "../brushes/brush-render-material.js";
import {
  createMirroredStrokeDataX,
  resolveDistanceSmoothedPressure,
  resolveGeneratorSolidMinLengthMeters,
  shouldSmoothStrokeSamplingPressure,
  shouldDiscardGeneratedStroke,
  shouldZeroInitialM11SamplingPressure,
  resolveStrokeSampleDecision,
  OPEN_BRUSH_MINIMUM_MOVE_METERS,
  resolveStrokeSpawnIntervalMeters,
  OPEN_BRUSH_PRESSURE_SMOOTH_WINDOW_METERS,
  OPEN_BRUSH_M11_PRESSURE_SMOOTH_WINDOW_METERS,
  upsertTapeMeasureEndpoints,
  upsertStraightedgeEndpoint,
  writeGridSnappedPosition,
  writeLazyInputPosition,
  writeStencilPlaneProjectedPosition,
  type StrokePointerFrame,
} from "../strokes/stroke-authoring.js";
import {
  brushSize01ToLiveBrushSize,
  normalizeBrushSize,
  OPEN_BRUSH_DEFAULT_STARTUP_SCREENSHOT_BRUSH_SIZE,
} from "../brushes/brush-size.js";
import { indexedTriangleGeometryIntersectsSphere } from "../strokes/geometry-intersections.js";
import { isOpenBrushEraserHit } from "../strokes/stroke-eraser.js";
import { isOpenBrushPickerHit } from "../strokes/stroke-picker.js";
import {
  OPEN_BRUSH_ERASER_FORWARD_OFFSET,
  OPEN_BRUSH_POINTER_TIP_FORWARD_OFFSET,
  isOpenBrushPanelFocusStatus,
  normalizeOpenBrushEraserRadius,
  resolveOpenBrushPanelFocusStatus,
  resolveOpenBrushPickerToolSpec,
  resolveOpenBrushTool,
  type OpenBrushToolDescriptor,
  type OpenBrushToolId,
  type OpenBrushToolLazyMode,
  type OpenBrushToolMirrorMode,
  type OpenBrushToolSamplingMode,
  type OpenBrushToolSnapMode,
  type OpenBrushToolStencilMode,
} from "../tools/tools.js";
import { isOpenBrushPanelFocusable } from "../panels/panel-focus.js";
import { resolveEffectiveOpenBrushTool } from "../tools/tool-modes.js";
import {
  createEmptyStrokeData,
  type ControlPoint,
  type Rgba,
  type StrokeData,
  type Vec3,
} from "../types.js";
import { StrokeEntityHistory } from "../strokes/stroke-entity-history.js";
import { writeOpenBrushToolOffsetPosition } from "../tools/tool-pose.js";
import {
  resolveOpenBrushPickerBrushSettings,
  type OpenBrushBrushSettingsSnapshot,
  type OpenBrushPickedStrokeSnapshot,
} from "../tools/picker-settings.js";

// Endpoint-move threshold for straightedge/tape tools only; freehand strokes
// use the Open Brush spawn-interval sampling in sampleActiveStroke.
import { AudioFeedbackSystem } from "./audio-feedback-system.js";

const MIN_SAMPLE_DISTANCE = 0.015;

const GRID_SNAP_SIZE = 0.1;
const LAZY_INPUT_RADIUS = 0.08;
const STENCIL_FRONT_PLANE_Z = -1.2;

// Half extents of custom wand panels in panel units (RING_PANEL_MAX_* / 2).
type BrushPointerHand = "left" | "right";

interface RuntimeStroke {
  entity: Entity;
  mesh: Mesh;
  geometry: BufferGeometry;
  geometryFamily: BrushGeometryFamily;
  geometryParams: BrushGeometryParams | undefined;
  generatorClass: string | undefined;
  pressureSizeRange: BrushPressureSizeRange | undefined;
  pressureOpacityRange: BrushPressureOpacityRange | undefined;
  deterministicParticleBirthTime: boolean;
  particleKnotIndexOffset: number;
  particleDistanceOffset: number;
  particleBirthTimeOffsetSeconds: number;
  geometryFinalized: boolean;
  toolId: OpenBrushToolId;
  groupId: number;
  samplingMode: OpenBrushToolSamplingMode;
  mirrorMode: OpenBrushToolMirrorMode;
  snapMode: OpenBrushToolSnapMode;
  lazyMode: OpenBrushToolLazyMode;
  stencilMode: OpenBrushToolStencilMode;
  strokeData: StrokeData;
  controlPoints: ControlPoint[];
  /** Position of the last "keeper" control point (Open Brush m_LastSpawnPos). */
  lastPosition: Vec3;
  /** Whether the most recent control point is a keeper (PointerScript semantics). */
  lastPointIsKeeper: boolean;
  /** Smoothed pressure at the last keeper (Open Brush m_LastSpawnPressure). */
  lastKeeperSmoothedPressure: number;
  /** Per-brush solid segment minimum length in meters. */
  solidMinLengthMeters: number;
  /** Reusable geometry storage (grown geometrically, written in place). */
  geometryArrays: BrushGeometryArrays;
  /**
   * Scene pose snapshot at stroke start: control points are authored in
   * canvas space so the sketch can be grabbed, turned, and scaled. The pose
   * is frozen while a stroke is live (the world grab is disabled while
   * painting).
   */
  posePosition: Vec3;
  poseOrientationInv: [number, number, number, number];
  poseScale: number;
  minBounds: Float32Array;
  maxBounds: Float32Array;
}

export class StrokeAuthoringSystem extends createSystem({
  commands: { required: [InputCommandState] },
  appState: { required: [OpenBrushAppState] },
  brushSettings: { required: [BrushSettings] },
  pointers: { required: [BrushPointer] },
  history: { required: [StrokeHistoryState] },
  settings: { required: [SettingsState] },
  layers: { required: [CanvasLayer] },
  strokes: { required: [BrushStroke] },
  hoveredPanels: { required: [PanelUI, OpenBrushPanelAttachment, Hovered] },
  hoveredCustomPanels: {
    required: [OpenBrushCustomPanel, OpenBrushPanelAttachment, Hovered],
  },
  eraserCursors: { required: [OpenBrushEraserCursor] },
  scenePoses: { required: [OpenBrushScenePose, Transform] },
  tipAnchors: { required: [OpenBrushTipAnchor, Transform] },
}) {
  private readonly samplePosition = new Vector3();
  private readonly sampleQuaternion = new Quaternion();
  private readonly cameraPosition = new Vector3();
  private readonly sampleDirection = new Vector3();
  private readonly sampleNdc = new Vector3();
  private readonly panelRayPosition = new Vector3();
  private readonly panelRayQuaternion = new Quaternion();
  private readonly rayDirection = new Vector3();
  private readonly tapeAnchorPosition = new Vector3();
  private readonly tapeAnchorQuaternion = new Quaternion();
  private readonly canvasPosition = new Vector3();
  private readonly canvasQuaternion = new Quaternion();
  private readonly poseQuaternionInv = new Quaternion();
  private readonly poseOriginScratch = new Vector3();
  private readonly eraserCenter: Vec3 = [0, 0, 0];
  private readonly pickerCenter: Vec3 = [0, 0, 0];
  private readonly canvasToolCenter: Vec3 = [0, 0, 0];
  private readonly strokeWorldPosition = new Vector3();
  private readonly strokeBoundsOffset: Vec3 = [0, 0, 0];
  private readonly sampleFrame: StrokePointerFrame = {
    paintPressed: true,
    pressure: 0,
    position: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    timestampMs: 0,
  };
  private readonly tapeAnchorFrame: StrokePointerFrame = {
    paintPressed: true,
    pressure: 0,
    position: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    timestampMs: 0,
  };
  private activeStroke: RuntimeStroke | undefined;
  private strokeCounter = 0;
  // Preview trail (Open Brush's preview line): a short decaying trail of the
  // current brush behind the idle tip. Rebuilt every frame from a rolling
  // buffer of recent tip poses.
  private previewTrail: RuntimeStroke | undefined;
  private previewBrushGuid = "";
  private readonly previewPointPool: ControlPoint[] = [];
  private readonly previewBirths: number[] = [];
  private readonly previewSamplePosition: Vec3 = [0, 0, 0];
  private previewClock = 0;
  private levelTimeOriginSeconds: number | undefined;
  private currentLevelTimeSeconds = 0;
  private readonly previewWorldPosition = new Vector3();
  private readonly previewWorldQuaternion = new Quaternion();
  private readonly previewPoseQuaternion = new Quaternion();
  private readonly previewLocalPosition = new Vector3();
  private readonly strokeHistory = new StrokeEntityHistory<Entity>();
  // Remote peers' in-progress strokes (collab mode), keyed by stroke guid.
  private readonly remoteActiveStrokes = new Map<string, RuntimeStroke>();
  /** Collab hooks — fired for LOCAL operations only, never for remote ones. */
  onLocalStrokesCommitted?: (strokes: StrokeData[]) => void;
  onLocalStrokeVisibility?: (guids: string[], visible: boolean) => void;
  private consumedStrokeUndoRequestRevision = 0;
  private consumedStrokeRedoRequestRevision = 0;
  private eraseHoldErasedCount = 0;
  private shaderMaterialsReady = false;
  private xrShaderWarmupStarted = false;

  init() {
    let disposed = false;
    this.cleanupFuncs.push(() => {
      disposed = true;
    });
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) {
          void this.warmUpImmersiveShaders();
        }
      }),
    );
    // The full-catalog warmup fetches tens of MB of shader textures, so it
    // waits out the landing-critical downloads (the intro sketch loads its
    // own brushes directly; the shader library cache dedups the overlap).
    void initialLoad.whenDone.then(() => {
      if (disposed) {
        return;
      }
      // Load all supported brushes, not just picker-visible ones: hidden
      // supported brushes (experimental/superseded) must still render with
      // their real shaders when a sketch references them.
      const shaderBrushes = openBrushInventory.filter(
        (entry) => entry.supportStatus === "supported",
      );
      const loads = shaderBrushes.map((entry) =>
        openBrushShaderLibrary.load(entry),
      );
      void Promise.all(loads).then(async (materials) => {
        if (disposed) {
          return;
        }
        const loadedCount = materials.filter(Boolean).length;
        const cullingFailures = shaderBrushes.flatMap((entry, index) => {
          if (!entry.portRequired) {
            return [];
          }
          const material = materials[index];
          const expectedSide = entry.geometryParams?.renderBackfaces
            ? DoubleSide
            : FrontSide;
          return material && material.side === expectedSide ? [] : [entry.name];
        });
        document.documentElement.dataset.brushCullingSettings =
          cullingFailures.length === 0 ? "pass" : "fail";
        if (cullingFailures.length > 0) {
          console.error(
            `[OpenBrushCulling] Required brush side mismatch: ${cullingFailures.join(", ")}`,
          );
        }
        const cutoutBrushes = new Set(["SingleSided", "DoubleFlat"]);
        const cutoutFailures = shaderBrushes.flatMap((entry, index) => {
          if (!cutoutBrushes.has(entry.name)) {
            return [];
          }
          const material = materials[index];
          return material && hasBrushMainTextureCutout(material.fragmentShader)
            ? []
            : [entry.name];
        });
        document.documentElement.dataset.brushTextureCutouts =
          cutoutFailures.length === 0 ? "pass" : "fail";
        if (cutoutFailures.length > 0) {
          console.error(
            `[OpenBrushTextureCutout] Missing diffuse cutout logic: ${cutoutFailures.join(", ")}`,
          );
        }
        const tubeToonIndex = shaderBrushes.findIndex(
          (entry) => entry.name === "TubeToonInverted",
        );
        const tubeToonMaterial = materials[tubeToonIndex];
        const tubeToonPassesReady = Boolean(
          tubeToonMaterial &&
            hasTubeToonInvertedPassContract(
              tubeToonMaterial.vertexShader,
              tubeToonMaterial.fragmentShader,
            ),
        );
        document.documentElement.dataset.brushTubeToonInverted =
          tubeToonPassesReady ? "pass" : "fail";
        if (!tubeToonPassesReady) {
          console.error(
            "[OpenBrushTubeToonInverted] Missing brush-pass shader contract.",
          );
        }
        if (loadedCount > 0) {
          await openBrushShaderLibrary.warmUp(
            this.renderer,
            this.scene,
            this.camera,
            "browser",
          );
          this.runRequestedVisualConformance();
        }
        this.shaderMaterialsReady = true;
        if (this.renderer.xr.isPresenting) {
          await this.warmUpImmersiveShaders();
        }
        console.log(
          `OpenBrush brush shader materials ready: ${loadedCount}/${loads.length} supported brushes.`,
        );
      });
    });
  }

  private async warmUpImmersiveShaders(): Promise<void> {
    if (!this.shaderMaterialsReady || this.xrShaderWarmupStarted) {
      return;
    }
    this.xrShaderWarmupStarted = true;
    await openBrushShaderLibrary.warmUp(
      this.renderer,
      this.scene,
      this.camera,
      "immersive-xr",
    );
  }

  private runRequestedVisualConformance(): void {
    const mode = new URLSearchParams(window.location.search).get(
      "visual-conformance",
    );
    if (
      mode === "particle" ||
      mode === "spray" ||
      mode === "midpoint" ||
      mode === "waveform" ||
      mode === "double-tapered" ||
      mode === "electricity" ||
      mode === "disco" ||
      mode === "light-wire" ||
      mode === "hyper-grid" ||
      mode === "square-paper" ||
      mode === "thick-geometry" ||
      mode === "hull" ||
      mode === "diamond-hull" ||
      mode === "smooth-hull" ||
      mode === "concave-hull" ||
      mode === "print3d" ||
      mode === "oil-paint" ||
      mode === "ink" ||
      mode === "thick-paint" ||
      mode === "wet-paint"
    ) {
      this.runGeometryVisualConformance(mode);
      return;
    }
    if (mode === "brush") {
      this.runGeometryVisualConformance("brush");
      return;
    }
    if (mode !== "bump") {
      return;
    }
    const brushGuid =
      new URLSearchParams(window.location.search).get("brush-guid") ??
      "f72ec0e7-a844-4e38-82e3-140c44772699";
    const entry = findBrushByGuid(openBrushInventory, brushGuid);
    const material = openBrushShaderLibrary.get(brushGuid);
    if (!entry || !material) {
      console.error(`${BRUSH_VISUAL_CONFORMANCE_PREFIX} ${brushGuid} did not load.`);
      document.documentElement.dataset.brushVisualConformance = "fail";
      return;
    }
    openBrushShaderLibrary.updateFrame(1, this.camera);
    const result = runBumpVisualConformance(this.renderer, material);
    openBrushShaderCompatibility.record({
      guid: brushGuid,
      name: entry.name,
      context: "visual",
      status: result.passed ? "visual-passed" : "visual-failed",
      message: `bump changed=${(result.changedPixelRatio * 100).toFixed(2)}% rms=${result.rootMeanSquareDifference.toFixed(2)}`,
    });
    showBumpVisualConformance(result, entry.name);
    document.documentElement.dataset.brushVisualConformance = result.passed
      ? "pass"
      : "fail";
    console.log(
      `${BRUSH_VISUAL_CONFORMANCE_PREFIX} ${result.passed ? "PASS" : "FAIL"} changed=${(result.changedPixelRatio * 100).toFixed(2)}% rms=${result.rootMeanSquareDifference.toFixed(2)} mean=${result.meanAbsoluteDifference.toFixed(2)}`,
    );
  }

  private runGeometryVisualConformance(
    mode:
      | "particle"
      | "spray"
      | "midpoint"
      | "waveform"
      | "double-tapered"
      | "electricity"
      | "disco"
      | "light-wire"
      | "hyper-grid"
      | "square-paper"
      | "thick-geometry"
      | "hull"
      | "diamond-hull"
      | "smooth-hull"
      | "concave-hull"
      | "print3d"
      | "oil-paint"
      | "ink"
      | "thick-paint"
      | "wet-paint"
      | "brush",
  ): void {
    const requestedBrushGuid = new URLSearchParams(window.location.search).get(
      "brush-guid",
    );
    const brushGuid =
      mode === "brush" && requestedBrushGuid
        ? requestedBrushGuid
        : mode === "spray"
        ? "8dc4a70c-d558-4efd-a5ed-d4e860f40dc3"
        : mode === "midpoint"
          ? "6a1cf9f9-032c-45ec-311e-a6680bee32e9"
          : mode === "waveform"
            ? "10201aa3-ebc2-42d8-84b7-2e63f6eeb8ab"
            : mode === "double-tapered"
              ? "0d3889f3-3ede-470c-8af4-de4813306126"
              : mode === "electricity"
                ? "f6e85de3-6dcc-4e7f-87fd-cee8c3d25d51"
                : mode === "disco"
                  ? "4391aaaa-df73-4396-9e33-31e4e4930b27"
                  : mode === "light-wire"
                    ? "4391aaaa-df81-4396-9e33-31e4e4930b27"
                    : mode === "hyper-grid"
                      ? "6a1cf9f9-032c-45ec-9b6e-a6680bee32e9"
                      : mode === "square-paper"
                        ? "2e03b1bf-3ebd-4609-9d7e-f4cafadc4dfa"
                        : mode === "thick-geometry"
                          ? "39ee7377-7a9e-47a7-a0f8-0c77712f75d3"
                          : mode === "hull"
                            ? "faaa4d44-fcfb-4177-96be-753ac0421ba3"
                            : mode === "diamond-hull"
                              ? "c8313697-2563-47fc-832e-290f4c04b901"
                              : mode === "smooth-hull"
                                ? "355b3579-bf1d-4ff5-a200-704437fe684b"
                                : mode === "concave-hull"
                                  ? "7ae1f880-a517-44a0-99f9-1cab654498c6"
                                  : mode === "print3d"
                                    ? "d3f3b18a-da03-f694-b838-28ba8e749a98"
                                    : mode === "oil-paint"
                                      ? "f72ec0e7-a844-4e38-82e3-140c44772699"
                                      : mode === "ink"
                                        ? "f5c336cf-5108-4b40-ade9-c687504385ab"
                                        : mode === "thick-paint"
                                          ? "75b32cf0-fdd6-4d89-a64b-e2a00b247b0f"
                                          : mode === "wet-paint"
                                            ? "b67c0e81-ce6d-40a8-aeb0-ef036b081aa3"
        : "70d79cca-b159-4f35-990c-f02193947fe8";
    const material = openBrushShaderLibrary.get(brushGuid);
    const entry = findBrushByGuid(openBrushInventory, brushGuid);
    if (!material || !entry) {
      console.error(
        `${BRUSH_VISUAL_CONFORMANCE_PREFIX} ${mode} material did not load.`,
      );
      document.documentElement.dataset.brushVisualConformance = "fail";
      return;
    }
    const mainTextureImporter = entry.shaderAssets?.textureImporters.MainTex;
    const mainTexture = material.uniforms.u_MainTex?.value as Texture | undefined;
    if (mainTextureImporter) {
      document.documentElement.dataset.brushTextureSettings =
        mainTexture &&
        matchesBrushTextureImporterSettings(mainTexture, mainTextureImporter)
          ? "pass"
          : "fail";
    }
    const stroke = createEmptyStrokeData({
      guid: "brush-visual-conformance-smoke",
      brushGuid,
      brushSize:
        mode === "brush"
          ? Math.min(
              entry.brushSizeRange[1],
              Math.max(
                entry.brushSizeRange[0],
                OPEN_BRUSH_DEFAULT_STARTUP_SCREENSHOT_BRUSH_SIZE,
              ),
            )
          : mode === "waveform"
            ? 0.4
            : 0.2,
      color:
        mode === "spray"
          ? [1, 0.1, 0.6, 1]
          : mode === "midpoint"
            ? [0.4, 1, 0.1, 1]
            : mode === "waveform"
              ? [0.1, 0.5, 1, 1]
              : mode === "double-tapered"
                ? [1, 0.4, 0.1, 1]
              : mode === "brush"
                ? [0.2, 0.2, 0.9019608, 1]
                : [0.1, 0.8, 1, 1],
      seed: 23,
      controlPoints: [
        {
          position: [-0.1, 0, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 0,
        },
        {
          position: mode === "particle" ? [0.1, 0, 0] : [0.5, 0, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 100,
        },
      ],
    });
    if (mode === "brush") {
      stroke.controlPoints = createOpenBrushScreenshotControlPoints();
      stroke.seed = 0;
      if (entry.name === "SingleSided") {
        for (const point of stroke.controlPoints) {
          point.orientation = [1, 0, 0, 0];
        }
      }
    }
    if (
      mode === "double-tapered" ||
      mode === "electricity"
    ) {
      stroke.controlPoints.splice(1, 0, {
        position: [0.2, 0, 0],
        orientation: [0, 0, 0, 1],
        pressure: 1,
        timestampMs: 50,
      });
    }
    if (mode === "concave-hull") {
      stroke.controlPoints.splice(
        0,
        stroke.controlPoints.length,
        {
          position: [-0.1, 0, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 0,
        },
        {
          position: [0.1, 0.1, 0],
          orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
          pressure: 1,
          timestampMs: 35,
        },
        {
          position: [0.3, -0.1, 0.15],
          orientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
          pressure: 1,
          timestampMs: 70,
        },
        {
          position: [0.5, 0.05, 0],
          orientation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
          pressure: 1,
          timestampMs: 105,
        },
      );
    }
    if (mode === "print3d") {
      stroke.controlPoints.splice(
        0,
        stroke.controlPoints.length,
        {
          position: [0, -0.25, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 0,
        },
        {
          position: [0, 0, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 50,
        },
        {
          position: [0.05, 0.25, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 100,
        },
      );
    }
    const geometry = generateBrushGeometry(stroke, entry.geometryFamily, {
      pressureSizeRange: entry.pressureSizeRange,
      pressureOpacityRange: entry.pressureOpacityRange,
      geometryParams: entry.geometryParams,
      generatorClass: entry.generatorClass,
    });
    const conformanceCamera =
      mode === "brush" ? createOpenBrushScreenshotCamera() : this.camera;
    openBrushShaderLibrary.updateFrame(
      mode === "brush" ? OPEN_BRUSH_SCREENSHOT_SHADER_TIME_SECONDS : 1,
      conformanceCamera,
    );
    const result = runBrushGeometryVisualConformance(
      this.renderer,
      material,
      geometry,
      entry.name,
      mode === "brush"
        ? entry.geometryFamily === "particle"
          ? "particle"
          : "stroke"
        : mode === "waveform" ||
        mode === "double-tapered" ||
        mode === "electricity" ||
        mode === "disco" ||
        mode === "light-wire" ||
        mode === "square-paper" ||
        mode === "thick-geometry" ||
        mode === "hull" ||
        mode === "diamond-hull" ||
        mode === "smooth-hull" ||
        mode === "concave-hull" ||
        mode === "print3d" ||
        mode === "oil-paint" ||
        mode === "ink" ||
        mode === "thick-paint" ||
        mode === "wet-paint"
        ? "stroke"
        : "particle",
      mode === "brush" ? conformanceCamera : undefined,
      mode === "brush" ? 0.001 : 0.005,
      mode === "brush" ? OPEN_BRUSH_SCREENSHOT_SIZE : undefined,
    );
    openBrushShaderCompatibility.record({
      guid: brushGuid,
      name: entry.name,
      context: "visual",
      status: result.passed ? "visual-passed" : "visual-failed",
      message: `${mode} coverage=${(result.coveredPixelRatio * 100).toFixed(2)}%`,
    });
    showBrushGeometryVisualConformance(result);
    document.documentElement.dataset.brushVisualConformance = result.passed
      ? "pass"
      : "fail";
    console.log(
      `${BRUSH_VISUAL_CONFORMANCE_PREFIX} ${result.passed ? "PASS" : "FAIL"} particleCoverage=${(result.coveredPixelRatio * 100).toFixed(2)}%`,
    );
  }

  update(_delta: number, time: number) {
    const levelTime = this.toLevelTimeSeconds(time);
    this.currentLevelTimeSeconds = levelTime;
    openBrushShaderLibrary.updateFrame(levelTime, this.camera);

    const commandEntity = this.getFirstEntity("commands");
    if (!commandEntity) {
      return;
    }
    this.updatePreviewTrail(_delta);

    this.consumeStrokeHistoryRequests(this.getFirstEntity("appState"));
    if (commandEntity.getValue(InputCommandState, "undoDown")) {
      this.undoLastStroke();
    }
    if (commandEntity.getValue(InputCommandState, "redoDown")) {
      this.redoLastStroke();
    }

    const rawPaintPressed = Boolean(
      commandEntity.getValue(InputCommandState, "paintPressed"),
    );
    const commandSource = String(commandEntity.getValue(InputCommandState, "source"));
    const activeTool = this.getActiveTool();
    const appStateEntity = this.getFirstEntity("appState");
    this.samplePointerPose(commandEntity, activeTool);
    if (!rawPaintPressed || !activeTool.erases) {
      this.eraseHoldErasedCount = 0;
    }
    if (rawPaintPressed && activeTool.erases) {
      if (this.activeStroke) {
        this.finalizeActiveStroke();
      }
      const blockReason = this.getEraseBlockReason(commandSource);
      if (blockReason === "panel") {
        this.setPanelFocusStatus(appStateEntity, activeTool);
      } else if (!blockReason) {
        this.clearPanelFocusStatus(appStateEntity, activeTool);
        this.eraseIntersectingStrokes();
      } else {
        this.clearPanelFocusStatus(appStateEntity, activeTool);
      }
      this.updateHistoryState();
      return;
    }

    if (this.isPickerTool(activeTool)) {
      if (this.activeStroke) {
        this.finalizeActiveStroke();
      }
      // DropperTool previews the hovered stroke every frame, before any
      // trigger press — but not while the ray is on UI (the reticle reads
      // as a tool cursor and the press belongs to the panel).
      const pickerOnUi = this.isPanelInteractionBlocked(commandSource);
      let hoverTarget: Entity | undefined;
      if (pickerOnUi) {
        this.clearDropperHover();
      } else {
        hoverTarget = this.updateDropperHover(activeTool);
      }
      const paintDown = Boolean(
        commandEntity.getValue(InputCommandState, "paintDown"),
      );
      if (paintDown) {
        const blockReason = this.getPickerBlockReason(commandSource, activeTool);
        if (blockReason === "panel") {
          this.setPanelFocusStatus(appStateEntity, activeTool);
        } else if (!blockReason) {
          this.clearPanelFocusStatus(appStateEntity, activeTool);
          this.pickWithDropper(activeTool, hoverTarget);
        } else {
          this.clearPanelFocusStatus(appStateEntity, activeTool);
        }
      }
      this.updateHistoryState();
      return;
    }
    this.clearDropperHover();

    // No painting while the intro gallery is up.
    if (
      appStateEntity &&
      String(appStateEntity.getValue(OpenBrushAppState, "mode")) === "intro"
    ) {
      if (this.activeStroke) {
        this.finalizeActiveStroke();
      }
      this.updateHistoryState();
      return;
    }

    // No stroke authoring while the world is grabbed (AllowWorldTransform
    // and stroke creation are mutually exclusive in Open Brush).
    const worldGrabActive = Boolean(
      this.getFirstEntity("scenePoses")?.getValue(OpenBrushScenePose, "grabActive"),
    );
    if (worldGrabActive) {
      if (this.activeStroke) {
        this.finalizeActiveStroke();
      }
      this.updateHistoryState();
      return;
    }

    // Non-painting tools (e.g. the camera) never author strokes.
    if (!activeTool.paints) {
      if (this.activeStroke) {
        this.finalizeActiveStroke();
      }
      this.updateHistoryState();
      return;
    }

    const paintBlockReason =
      rawPaintPressed && !this.activeStroke
        ? this.getPaintStartBlockReason(commandSource)
        : undefined;
    const paintPressed =
      rawPaintPressed && (!!this.activeStroke || !paintBlockReason);
    if (paintPressed) {
      this.clearPanelFocusStatus(appStateEntity, activeTool);
      const pressure = Number(commandEntity.getValue(InputCommandState, "pressure"));
      if (!this.activeStroke) {
        this.startStroke(commandEntity, levelTime, pressure);
      } else if (this.activeStroke.samplingMode === "straightedge") {
        this.sampleStraightedgeStroke(levelTime, pressure);
      } else if (this.activeStroke.samplingMode === "tape") {
        this.sampleTapeStroke(levelTime, pressure);
      } else {
        this.sampleActiveStroke(levelTime, pressure, false);
      }
    } else if (paintBlockReason === "panel") {
      this.setPanelFocusStatus(appStateEntity, activeTool);
    } else if (paintBlockReason) {
      this.clearPanelFocusStatus(appStateEntity, activeTool);
    } else if (this.activeStroke) {
      this.finalizeActiveStroke();
    }

    this.updateHistoryState();
  }

  private toLevelTimeSeconds(time: number): number {
    if (!Number.isFinite(time)) {
      return 0;
    }
    if (this.levelTimeOriginSeconds === undefined) {
      this.levelTimeOriginSeconds = time;
    }
    return Math.max(0, time - this.levelTimeOriginSeconds);
  }

  private isHoveringPanel(): boolean {
    for (const entity of this.queries.hoveredPanels.entities) {
      if (this.isFocusablePanel(entity)) {
        return true;
      }
    }
    for (const entity of this.queries.hoveredCustomPanels.entities) {
      if (
        entity.object3D?.visible !== false &&
        Boolean(entity.getValue(OpenBrushPanelAttachment, "visible"))
      ) {
        return true;
      }
    }
    return false;
  }

  private getPaintStartBlockReason(
    commandSource: string,
  ): "tool" | "layer" | "panel" | undefined {
    if (!this.isActiveToolPaintTool()) {
      return "tool";
    }
    if (!this.isActiveLayerPaintable()) {
      return "layer";
    }
    return this.isPanelInteractionBlocked(commandSource) ? "panel" : undefined;
  }

  private isActiveToolPaintTool(): boolean {
    return this.getActiveTool().paints;
  }

  private isPickerTool(tool: OpenBrushToolDescriptor): boolean {
    return resolveOpenBrushPickerToolSpec(tool.id) !== undefined;
  }

  private getEraseBlockReason(
    commandSource: string,
  ): "tool" | "layer" | "panel" | undefined {
    if (!this.getActiveTool().erases) {
      return "tool";
    }
    if (!this.isActiveLayerPaintable()) {
      return "layer";
    }
    return this.isPanelInteractionBlocked(commandSource) ? "panel" : undefined;
  }

  private getPickerBlockReason(
    commandSource: string,
    activeTool: OpenBrushToolDescriptor,
  ): "tool" | "layer" | "panel" | undefined {
    if (!this.isPickerTool(activeTool)) {
      return "tool";
    }
    if (!this.isActiveLayerPaintable()) {
      return "layer";
    }
    return this.isPanelInteractionBlocked(commandSource) ? "panel" : undefined;
  }

  private isPanelInteractionBlocked(commandSource: string): boolean {
    if (commandSource === "xr-right" || commandSource === "xr-left") {
      // InputCommandSystem publishes the input system's own ray-pointer
      // intersection — the same raycast that drives UIKit clicks — so this
      // matches the visible ray exactly (the tip anchor points elsewhere by
      // design) and covers every interactable panel, keypad included.
      const commandEntity = this.getFirstEntity("commands");
      return Boolean(commandEntity?.getValue(InputCommandState, "pointerOnUi"));
    }
    return this.isHoveringPanel();
  }

  private isActiveLayerPaintable(): boolean {
    const appStateEntity = this.getFirstEntity("appState");
    const activeLayerIndex = appStateEntity
      ? Number(appStateEntity.getValue(OpenBrushAppState, "activeLayerIndex"))
      : 0;

    for (const layer of this.queries.layers.entities) {
      if (
        !layer.getValue(CanvasLayer, "selectionCanvas") &&
        Number(layer.getValue(CanvasLayer, "layerIndex")) === activeLayerIndex
      ) {
        return (
          Boolean(layer.getValue(CanvasLayer, "visible")) &&
          !Boolean(layer.getValue(CanvasLayer, "locked"))
        );
      }
    }
    return false;
  }

  private isFocusablePanel(entity: Entity): boolean {
    return isOpenBrushPanelFocusable({
      objectVisible: entity.object3D?.visible !== false,
      attachmentVisible: Boolean(
        entity.getValue(OpenBrushPanelAttachment, "visible"),
      ),
      maxWidth: Number(entity.getValue(PanelUI, "maxWidth")),
      maxHeight: Number(entity.getValue(PanelUI, "maxHeight")),
    });
  }

  private startStroke(
    commandEntity: Entity,
    time: number,
    pressure: number,
  ): void {
    const settingsEntity = this.getFirstEntity("brushSettings");
    const appStateEntity = this.getFirstEntity("appState");
    const brushGuid = settingsEntity
      ? String(settingsEntity.getValue(BrushSettings, "brushGuid"))
      : "";
    const brushSize = settingsEntity
      ? normalizeBrushSize(Number(settingsEntity.getValue(BrushSettings, "size")))
      : normalizeBrushSize(0);
    const color = this.getBrushColor(settingsEntity);
    const layerIndex = appStateEntity
      ? Number(appStateEntity.getValue(OpenBrushAppState, "activeLayerIndex"))
      : 0;
    const brushEntry = findBrushByGuid(openBrushInventory, brushGuid);
    const geometryFamily = brushEntry?.geometryFamily ?? "unsupported";
    const materialSpec = createBrushMaterialSpec(brushEntry, color);
    const activeTool = this.getActiveTool();

    this.strokeCounter += 1;
    const guid = `runtime-stroke-${this.strokeCounter}`;
    const groupId = this.strokeCounter;
    // Author in canvas space: sizes and positions divide out the scene pose,
    // like PointerScript converting room space to canvas space.
    const poseEntity = this.getFirstEntity("scenePoses");
    const poseObject = poseEntity?.object3D;
    const poseScale = poseObject ? poseObject.scale.x || 1 : 1;
    const canvasBrushSize = brushSize / poseScale;
    const strokeData = createEmptyStrokeData({
      guid,
      brushGuid,
      brushSize: canvasBrushSize,
      brushScale: 1,
      color,
      layerIndex,
      seed: this.strokeCounter,
      groupId,
      controlPoints: [],
    });
    const geometry = new BufferGeometry();
    const material = this.createStrokeRenderMaterial(
      brushEntry,
      materialSpec,
      color[3],
    );
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = `OpenBrushStrokeMesh_${this.strokeCounter}`;

    const entity = poseEntity
      ? this.world.createTransformEntity(mesh, poseEntity)
      : this.world.createTransformEntity(mesh);
    entity.object3D!.name = `OpenBrushStroke_${this.strokeCounter}`;
    entity.addComponent(BrushStroke, {
      guid,
      brushGuid,
      toolId: activeTool.id,
      groupId,
      groupContinuation: false,
      geometryFamily,
      materialFamily: materialSpec.materialFamily,
      renderWarning: materialSpec.warning ?? "",
      layerIndex,
      brushSize: canvasBrushSize,
      color,
      finalized: false,
      visible: true,
      renderVisible: true,
      selected: false,
      controlPointCount: 0,
      vertexCount: 0,
      indexCount: 0,
      commandIndex: this.strokeCounter,
    });

    const stroke: RuntimeStroke = {
      entity,
      mesh,
      geometry,
      geometryFamily,
      geometryParams: brushEntry?.geometryParams,
      generatorClass: brushEntry?.generatorClass,
      pressureSizeRange: brushEntry?.pressureSizeRange,
      pressureOpacityRange: brushEntry?.pressureOpacityRange,
      deterministicParticleBirthTime: false,
      particleKnotIndexOffset: 0,
      particleDistanceOffset: 0,
      particleBirthTimeOffsetSeconds: 0,
      geometryFinalized: false,
      toolId: activeTool.id,
      groupId,
      samplingMode: activeTool.samplingMode,
      mirrorMode: activeTool.mirrorMode,
      snapMode: activeTool.snapMode,
      lazyMode: activeTool.lazyMode,
      stencilMode: activeTool.stencilMode,
      strokeData,
      controlPoints: strokeData.controlPoints,
      lastPosition: [0, 0, 0],
      lastPointIsKeeper: false,
      lastKeeperSmoothedPressure: 0,
      solidMinLengthMeters:
        resolveGeneratorSolidMinLengthMeters({
          generatorClass: brushEntry?.generatorClass,
          descriptorValue: brushEntry?.geometryParams?.solidMinLengthMeters,
          geometryFamily,
        }) / poseScale,
      geometryArrays: createBrushGeometryArrays(),
      posePosition: poseObject
        ? [poseObject.position.x, poseObject.position.y, poseObject.position.z]
        : [0, 0, 0],
      poseOrientationInv: poseObject
        ? (this.poseQuaternionInv
            .copy(poseObject.quaternion)
            .invert()
            .toArray() as [number, number, number, number])
        : [0, 0, 0, 1],
      poseScale,
      minBounds: entity.getVectorView(BrushStroke, "minBounds") as Float32Array,
      maxBounds: entity.getVectorView(BrushStroke, "maxBounds") as Float32Array,
    };
    this.activeStroke = stroke;
    this.strokeHistory.clearRedo();
    if (stroke.samplingMode === "tape") {
      this.sampleTapeStroke(time, pressure);
    } else {
      this.sampleActiveStroke(time, pressure, true);
    }
    this.setActivePointerSampleCount(commandEntity);
  }

  private sampleActiveStroke(
    time: number,
    pressure: number,
    force: boolean,
  ): void {
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }

    const frame = this.writeSampleFrame(time, pressure, stroke);

    // Open Brush sampling: a new solid segment ("keeper") spawns every
    // spawn-interval of travel; between keepers the trailing control point is
    // overwritten each frame so the stroke tip tracks the pointer exactly.
    const dx = frame.position[0] - stroke.lastPosition[0];
    const dy = frame.position[1] - stroke.lastPosition[1];
    const dz = frame.position[2] - stroke.lastPosition[2];
    const pressureWindowMeters =
      (stroke.geometryParams?.m11Compatibility === true
        ? OPEN_BRUSH_M11_PRESSURE_SMOOTH_WINDOW_METERS
        : OPEN_BRUSH_PRESSURE_SMOOTH_WINDOW_METERS) / stroke.poseScale;
    const smoothedPressure =
      stroke.controlPoints.length === 0
        ? stroke.geometryParams?.m11Compatibility === true &&
          shouldZeroInitialM11SamplingPressure(stroke.generatorClass)
          ? 0
          : frame.pressure
        : resolveDistanceSmoothedPressure({
            previousPressure: stroke.lastKeeperSmoothedPressure,
            pressure: frame.pressure,
            distanceMeters: Math.hypot(dx, dy, dz),
            windowMeters: pressureWindowMeters,
          });
    const samplingPressure = shouldSmoothStrokeSamplingPressure(
      stroke.generatorClass,
    )
      ? smoothedPressure
      : frame.pressure;
    const spawnInterval = resolveStrokeSpawnIntervalMeters({
      brushSize: stroke.strokeData.brushSize,
      pressure: samplingPressure,
      pressureSizeMin: stroke.pressureSizeRange?.[0],
      solidMinLengthMeters: stroke.solidMinLengthMeters,
      generatorClass: stroke.generatorClass,
      sprayRateMultiplier: stroke.geometryParams?.sprayRateMultiplier,
      particleRate: stroke.geometryParams?.particleRate,
      localUnitsPerMeter: 1 / stroke.poseScale,
    });
    const decision = force
      ? "keep"
      : resolveStrokeSampleDecision(
          stroke.lastPosition,
          frame.position,
          spawnInterval,
          OPEN_BRUSH_MINIMUM_MOVE_METERS / stroke.poseScale,
        );
    if (decision === "ignore") {
      return;
    }

    let index: number;
    let controlPoint: ControlPoint;
    if (stroke.lastPointIsKeeper || stroke.controlPoints.length === 0) {
      index = stroke.controlPoints.length;
      controlPoint = {
        position: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        pressure: frame.pressure,
        timestampMs: frame.timestampMs,
      };
      stroke.controlPoints.push(controlPoint);
    } else {
      index = stroke.controlPoints.length - 1;
      controlPoint = stroke.controlPoints[index];
    }
    controlPoint.position[0] = frame.position[0];
    controlPoint.position[1] = frame.position[1];
    controlPoint.position[2] = frame.position[2];
    controlPoint.orientation[0] = frame.orientation[0];
    controlPoint.orientation[1] = frame.orientation[1];
    controlPoint.orientation[2] = frame.orientation[2];
    controlPoint.orientation[3] = frame.orientation[3];
    controlPoint.pressure = frame.pressure;
    controlPoint.timestampMs = frame.timestampMs;

    if (decision === "keep") {
      stroke.lastPosition[0] = frame.position[0];
      stroke.lastPosition[1] = frame.position[1];
      stroke.lastPosition[2] = frame.position[2];
      stroke.lastPointIsKeeper = true;
      stroke.lastKeeperSmoothedPressure = samplingPressure;
    } else {
      stroke.lastPointIsKeeper = false;
    }

    this.updateBounds(stroke, index, frame.position);
    this.rebuildStrokeMesh(stroke);
    stroke.entity.setValue(
      BrushStroke,
      "controlPointCount",
      stroke.controlPoints.length,
    );
    this.setPointerSampleCount(stroke.controlPoints.length);
  }

  private sampleStraightedgeStroke(time: number, pressure: number): void {
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }

    const result = upsertStraightedgeEndpoint(
      stroke.controlPoints,
      this.writeSampleFrame(time, pressure, stroke),
      MIN_SAMPLE_DISTANCE,
    );
    if (result === "ignored") {
      return;
    }

    this.recalculateBounds(stroke);
    this.rebuildStrokeMesh(stroke);
    stroke.entity.setValue(
      BrushStroke,
      "controlPointCount",
      stroke.controlPoints.length,
    );
    this.setPointerSampleCount(stroke.controlPoints.length);
  }

  private sampleTapeStroke(time: number, pressure: number): void {
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }

    const result = upsertTapeMeasureEndpoints(
      stroke.controlPoints,
      this.writeTapeAnchorFrame(time, pressure),
      this.writeSampleFrame(time, pressure, stroke),
      MIN_SAMPLE_DISTANCE,
    );
    if (result === "ignored") {
      return;
    }

    this.recalculateBounds(stroke);
    this.rebuildStrokeMesh(stroke);
    stroke.entity.setValue(
      BrushStroke,
      "controlPointCount",
      stroke.controlPoints.length,
    );
    this.setPointerSampleCount(stroke.controlPoints.length);
  }

  /**
   * Prefer the brush's real Open Brush GLSL material (shared per GUID) when
   * it has loaded; otherwise fall back to the semantic MeshBasicMaterial.
   */
  private createStrokeRenderMaterial(
    brushEntry: BrushInventoryEntry | undefined,
    materialSpec: BrushMaterialSpec,
    opacity: number,
  ): Material | Material[] {
    if (brushEntry) {
      const shaderMaterial = openBrushShaderLibrary.get(brushEntry.guid);
      if (shaderMaterial) {
        return createBrushRenderMaterial(
          brushEntry.guid,
          shaderMaterial,
          openBrushShaderLibrary.frameUniforms,
        );
      }
    }
    return new MeshBasicMaterial({
      vertexColors: materialSpec.vertexColors,
      side: materialSpec.doubleSided ? DoubleSide : FrontSide,
      opacity,
      transparent: materialSpec.transparent,
      depthWrite: materialSpec.depthWrite,
      alphaTest: materialSpec.alphaCutoff,
      blending:
        materialSpec.blending === "additive" ? AdditiveBlending : NormalBlending,
    });
  }

  private rebuildStrokeMesh(stroke: RuntimeStroke): void {
    const arrays = stroke.geometryArrays;
    const reallocated = generateBrushGeometryInto(
      stroke.strokeData,
      stroke.geometryFamily,
      {
        pressureSizeRange: stroke.pressureSizeRange,
        pressureOpacityRange: stroke.pressureOpacityRange,
        geometryParams: stroke.geometryParams,
        generatorClass: stroke.generatorClass,
        deterministicBirthTime: stroke.deterministicParticleBirthTime,
        particleKnotIndexOffset: stroke.particleKnotIndexOffset,
        particleDistanceOffset: stroke.particleDistanceOffset,
        particleBirthTimeOffsetSeconds: stroke.particleBirthTimeOffsetSeconds,
        particlePreview: stroke === this.previewTrail,
        finalized: stroke.geometryFinalized,
        lastControlPointIsKeeper:
          stroke.samplingMode === "freehand" ? stroke.lastPointIsKeeper : true,
      },
      arrays,
    );

    // Rebuilds run every sampled frame while drawing: reuse the GPU-bound
    // attributes and rebind only when storage grows or the UV layout changes.
    const currentShaderUv = stroke.geometry.getAttribute("a_texcoord0");
    if (
      reallocated ||
      !stroke.geometry.getAttribute("position") ||
      currentShaderUv?.itemSize !== arrays.uv0Size
    ) {
      const position = new BufferAttribute(arrays.positions, 3);
      const normal = new BufferAttribute(arrays.normals, 3);
      const tangent = new BufferAttribute(arrays.tangents, 4);
      const color = new BufferAttribute(arrays.colors, 4);
      const uv = new BufferAttribute(arrays.uvs, 2);
      const shaderUv =
        arrays.uv0Size === 3
          ? new BufferAttribute(arrays.packedUvs, 3)
          : arrays.uv0Size === 4
            ? new BufferAttribute(arrays.particleUvs, 4)
            : uv;
      const shaderUv1 =
        arrays.uv1Size === 3
          ? new BufferAttribute(arrays.vectorUvs, 3)
          : new BufferAttribute(arrays.uv1s, 4);
      const index = new BufferAttribute(arrays.indices, 1);
      for (const attribute of [
        position,
        normal,
        tangent,
        color,
        uv,
        shaderUv,
        shaderUv1,
        index,
      ]) {
        attribute.setUsage(DynamicDrawUsage);
      }
      stroke.geometry.setAttribute("position", position);
      stroke.geometry.setAttribute("normal", normal);
      stroke.geometry.setAttribute("tangent", tangent);
      stroke.geometry.setAttribute("color", color);
      stroke.geometry.setAttribute("uv", uv);
      applyBrushShaderAttributeAliases(stroke.geometry);
      stroke.geometry.setAttribute("a_texcoord0", shaderUv);
      if (arrays.uv1Size > 0) {
        stroke.geometry.setAttribute("uv1", shaderUv1);
        stroke.geometry.setAttribute("a_texcoord1", shaderUv1);
      } else {
        stroke.geometry.deleteAttribute("uv1");
        stroke.geometry.deleteAttribute("a_texcoord1");
      }
      stroke.geometry.setIndex(index);
    } else {
      this.markAttributeRangeUpdated(
        stroke.geometry.getAttribute("position") as BufferAttribute,
        arrays.vertexCount,
      );
      this.markAttributeRangeUpdated(
        stroke.geometry.getAttribute("normal") as BufferAttribute,
        arrays.vertexCount,
      );
      this.markAttributeRangeUpdated(
        stroke.geometry.getAttribute("tangent") as BufferAttribute,
        arrays.vertexCount,
      );
      this.markAttributeRangeUpdated(
        stroke.geometry.getAttribute("color") as BufferAttribute,
        arrays.vertexCount,
      );
      this.markAttributeRangeUpdated(
        stroke.geometry.getAttribute("uv") as BufferAttribute,
        arrays.vertexCount,
      );
      const shaderUv = stroke.geometry.getAttribute("a_texcoord0");
      if (shaderUv && shaderUv !== stroke.geometry.getAttribute("uv")) {
        this.markAttributeRangeUpdated(
          shaderUv as BufferAttribute,
          arrays.vertexCount,
        );
      }
      const shaderUv1 = stroke.geometry.getAttribute("a_texcoord1");
      if (shaderUv1) {
        this.markAttributeRangeUpdated(
          shaderUv1 as BufferAttribute,
          arrays.vertexCount,
        );
      }
      const index = stroke.geometry.getIndex();
      if (index) {
        this.markAttributeRangeUpdated(index, arrays.indexCount);
      }
    }
    applyBrushShaderSupplementalAttributes(
      stroke.geometry,
      stroke.strokeData.brushGuid,
      arrays.vertexCount,
    )?.setUsage(DynamicDrawUsage);
    stroke.geometry.setDrawRange(0, arrays.indexCount);
    applyBrushRenderGroups(stroke.geometry, arrays.indexCount, stroke.mesh.material);
    this.copyGeneratedBounds(stroke, arrays.bounds.min, arrays.bounds.max);
    // The preview trail reuses this path with a component-less entity.
    if (stroke.entity.hasComponent(BrushStroke)) {
      stroke.entity.setValue(BrushStroke, "vertexCount", arrays.vertexCount);
      stroke.entity.setValue(BrushStroke, "indexCount", arrays.indexCount);
      if (arrays.warning) {
        stroke.entity.setValue(BrushStroke, "renderWarning", arrays.warning);
      }
    }
  }

  private markAttributeRangeUpdated(
    attribute: BufferAttribute,
    usedElementCount: number,
  ): void {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, usedElementCount * attribute.itemSize);
    attribute.needsUpdate = true;
  }

  private copyGeneratedBounds(
    stroke: RuntimeStroke,
    minBounds: Vec3,
    maxBounds: Vec3,
  ): void {
    if (
      !Number.isFinite(minBounds[0]) ||
      !Number.isFinite(minBounds[1]) ||
      !Number.isFinite(minBounds[2]) ||
      !Number.isFinite(maxBounds[0]) ||
      !Number.isFinite(maxBounds[1]) ||
      !Number.isFinite(maxBounds[2])
    ) {
      return;
    }

    stroke.minBounds[0] = minBounds[0];
    stroke.minBounds[1] = minBounds[1];
    stroke.minBounds[2] = minBounds[2];
    stroke.maxBounds[0] = maxBounds[0];
    stroke.maxBounds[1] = maxBounds[1];
    stroke.maxBounds[2] = maxBounds[2];
  }

  private recalculateBounds(stroke: RuntimeStroke): void {
    if (stroke.controlPoints.length === 0) {
      stroke.minBounds[0] = 0;
      stroke.minBounds[1] = 0;
      stroke.minBounds[2] = 0;
      stroke.maxBounds[0] = 0;
      stroke.maxBounds[1] = 0;
      stroke.maxBounds[2] = 0;
      return;
    }

    const first = stroke.controlPoints[0].position;
    stroke.minBounds[0] = first[0];
    stroke.minBounds[1] = first[1];
    stroke.minBounds[2] = first[2];
    stroke.maxBounds[0] = first[0];
    stroke.maxBounds[1] = first[1];
    stroke.maxBounds[2] = first[2];
    for (let index = 1; index < stroke.controlPoints.length; index += 1) {
      const position = stroke.controlPoints[index].position;
      if (position[0] < stroke.minBounds[0]) {
        stroke.minBounds[0] = position[0];
      }
      if (position[1] < stroke.minBounds[1]) {
        stroke.minBounds[1] = position[1];
      }
      if (position[2] < stroke.minBounds[2]) {
        stroke.minBounds[2] = position[2];
      }
      if (position[0] > stroke.maxBounds[0]) {
        stroke.maxBounds[0] = position[0];
      }
      if (position[1] > stroke.maxBounds[1]) {
        stroke.maxBounds[1] = position[1];
      }
      if (position[2] > stroke.maxBounds[2]) {
        stroke.maxBounds[2] = position[2];
      }
    }
  }

  private updateBounds(
    stroke: RuntimeStroke,
    index: number,
    position: Vec3,
  ): void {
    const x = position[0];
    const y = position[1];
    const z = position[2];
    if (index === 0) {
      stroke.minBounds[0] = x;
      stroke.minBounds[1] = y;
      stroke.minBounds[2] = z;
      stroke.maxBounds[0] = x;
      stroke.maxBounds[1] = y;
      stroke.maxBounds[2] = z;
      return;
    }

    if (x < stroke.minBounds[0]) {
      stroke.minBounds[0] = x;
    }
    if (y < stroke.minBounds[1]) {
      stroke.minBounds[1] = y;
    }
    if (z < stroke.minBounds[2]) {
      stroke.minBounds[2] = z;
    }
    if (x > stroke.maxBounds[0]) {
      stroke.maxBounds[0] = x;
    }
    if (y > stroke.maxBounds[1]) {
      stroke.maxBounds[1] = y;
    }
    if (z > stroke.maxBounds[2]) {
      stroke.maxBounds[2] = z;
    }
  }

  private static readonly PREVIEW_POINT_LIFE_SECONDS = 0.2;
  private static readonly PREVIEW_IDEAL_LENGTH_METERS = 1;

  /**
   * Open Brush preview line: while the paint tool is idle, a short trail of
   * the current brush follows the tip and decays after 0.2s, tapered toward
   * the tail and thinned when the trail is short (Pointer_Main params).
   */
  private updatePreviewTrail(delta: number): void {
    this.previewClock += delta;
    const commandEntity = this.getFirstEntity("commands");
    const appStateEntity = this.getFirstEntity("appState");
    const settingsEntity = this.getFirstEntity("brushSettings");
    const poseEntity = this.getFirstEntity("scenePoses");
    const poseObject = poseEntity?.object3D;
    const activeTool = this.getActiveTool();
    const worldGrabActive = Boolean(
      poseEntity?.getValue(OpenBrushScenePose, "grabActive"),
    );
    const commandSource = commandEntity
      ? String(commandEntity.getValue(InputCommandState, "source"))
      : "";
    const show =
      !!commandEntity &&
      !!appStateEntity &&
      !!settingsEntity &&
      !!poseObject &&
      String(appStateEntity.getValue(OpenBrushAppState, "mode")) === "ready" &&
      activeTool.paints &&
      !activeTool.erases &&
      !this.activeStroke &&
      !worldGrabActive &&
      !this.getPaintStartBlockReason(commandSource);
    if (!show) {
      this.resetPreviewTrailPoints();
      return;
    }

    const hand = this.resolveBrushPointerHand(commandEntity);
    const anchor = this.getTipAnchorObject(hand);
    if (!anchor) {
      this.resetPreviewTrailPoints();
      return;
    }

    const brushGuid = String(settingsEntity.getValue(BrushSettings, "brushGuid"));
    const trail = this.ensurePreviewTrail(brushGuid);
    if (!trail) {
      return;
    }

    // Tip pose in canvas space, like strokes themselves.
    anchor.getWorldPosition(this.previewWorldPosition);
    anchor.getWorldQuaternion(this.previewWorldQuaternion);
    this.previewLocalPosition.copy(this.previewWorldPosition);
    poseObject.worldToLocal(this.previewLocalPosition);
    poseObject.getWorldQuaternion(this.previewPoseQuaternion).invert();
    this.previewWorldQuaternion.premultiply(this.previewPoseQuaternion);

    const points = trail.strokeData.controlPoints;
    const poseScale = poseObject.scale.x || 1;
    if (poseScale !== trail.poseScale) {
      trail.solidMinLengthMeters *= trail.poseScale / poseScale;
      trail.poseScale = poseScale;
    }
    trail.strokeData.brushSize =
      Number(settingsEntity.getValue(BrushSettings, "size")) / poseScale;
    const spawnInterval = resolveStrokeSpawnIntervalMeters({
      brushSize: trail.strokeData.brushSize,
      pressure: 1,
      pressureSizeMin: trail.pressureSizeRange?.[0],
      solidMinLengthMeters: trail.solidMinLengthMeters,
      generatorClass: trail.generatorClass,
      sprayRateMultiplier: trail.geometryParams?.sprayRateMultiplier,
      particleRate: trail.geometryParams?.particleRate,
      localUnitsPerMeter: 1 / poseScale,
    });
    const currentPosition = this.previewSamplePosition;
    currentPosition[0] = this.previewLocalPosition.x;
    currentPosition[1] = this.previewLocalPosition.y;
    currentPosition[2] = this.previewLocalPosition.z;
    const decision =
      points.length === 0
        ? "keep"
        : resolveStrokeSampleDecision(
            trail.lastPosition,
            currentPosition,
            spawnInterval,
            OPEN_BRUSH_MINIMUM_MOVE_METERS / poseScale,
          );
    if (decision !== "ignore") {
      let point: ControlPoint;
      let pointIndex: number;
      if (trail.lastPointIsKeeper || points.length === 0) {
        point = this.previewPointPool.pop() ?? {
          position: [0, 0, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 0,
        };
        points.push(point);
        this.previewBirths.push(this.previewClock);
        pointIndex = points.length - 1;
      } else {
        pointIndex = points.length - 1;
        point = points[pointIndex];
        this.previewBirths[pointIndex] = this.previewClock;
      }
      point.position[0] = currentPosition[0];
      point.position[1] = currentPosition[1];
      point.position[2] = currentPosition[2];
      point.orientation[0] = this.previewWorldQuaternion.x;
      point.orientation[1] = this.previewWorldQuaternion.y;
      point.orientation[2] = this.previewWorldQuaternion.z;
      point.orientation[3] = this.previewWorldQuaternion.w;
      point.pressure = 1;
      point.timestampMs = this.previewClock * 1000;
      trail.lastPointIsKeeper = decision === "keep";
      if (trail.lastPointIsKeeper) {
        trail.lastPosition[0] = currentPosition[0];
        trail.lastPosition[1] = currentPosition[1];
        trail.lastPosition[2] = currentPosition[2];
      }
    }
    while (
      this.previewBirths.length > 2 &&
      this.previewClock - this.previewBirths[0] >
        StrokeAuthoringSystem.PREVIEW_POINT_LIFE_SECONDS
    ) {
      this.previewBirths.shift();
      const expired = points.shift();
      if (expired) {
        this.previewPointPool.push(expired);
        trail.particleKnotIndexOffset += 1;
        const next = points[0];
        if (next) {
          trail.particleDistanceOffset += Math.hypot(
            next.position[0] - expired.position[0],
            next.position[1] - expired.position[1],
            next.position[2] - expired.position[2],
          );
        }
      }
    }
    if (points.length < 2) {
      trail.mesh.visible = false;
      return;
    }
    trail.mesh.visible = true;

    // Width: taper toward the tail, and thin the whole trail when it is
    // short relative to the ideal length (in room space).
    let canvasLength = 0;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1].position;
      const b = points[i].position;
      canvasLength += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
    const length01 = Math.min(
      1,
      (canvasLength * poseScale) /
        StrokeAuthoringSystem.PREVIEW_IDEAL_LENGTH_METERS,
    );
    const fullWidthIndex = Math.max(1, points.length - 3);
    for (let i = 0; i < points.length; i += 1) {
      points[i].pressure = Math.min(1, i / fullWidthIndex) * length01;
    }

    const colorView = settingsEntity.getVectorView(
      BrushSettings,
      "color",
    ) as Float32Array;
    trail.strokeData.color[0] = colorView[0];
    trail.strokeData.color[1] = colorView[1];
    trail.strokeData.color[2] = colorView[2];
    trail.strokeData.color[3] = colorView[3] > 0 ? colorView[3] : 1;
    this.rebuildStrokeMesh(trail);
  }

  /** The preview entity carries NO BrushStroke component, so save, erase,
   * collab, and sketch transitions never see it. */
  private ensurePreviewTrail(brushGuid: string): RuntimeStroke | undefined {
    if (this.previewTrail && this.previewBrushGuid === brushGuid) {
      return this.previewTrail;
    }
    this.disposePreviewTrail();
    const settingsEntity = this.getFirstEntity("brushSettings");
    if (!settingsEntity) {
      return undefined;
    }
    const brushEntry = findBrushByGuid(openBrushInventory, brushGuid);
    const colorView = settingsEntity.getVectorView(
      BrushSettings,
      "color",
    ) as Float32Array;
    const color: Rgba = [
      colorView[0],
      colorView[1],
      colorView[2],
      colorView[3] > 0 ? colorView[3] : 1,
    ];
    const materialSpec = createBrushMaterialSpec(brushEntry, color);
    const geometry = new BufferGeometry();
    const material = this.createStrokeRenderMaterial(
      brushEntry,
      materialSpec,
      color[3],
    );
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.raycast = () => {};
    mesh.name = "OpenBrushPreviewTrail";
    mesh.visible = false;
    const poseEntity = this.getFirstEntity("scenePoses");
    const entity = poseEntity
      ? this.world.createTransformEntity(mesh, poseEntity)
      : this.world.createTransformEntity(mesh);
    entity.object3D!.name = "OpenBrushPreviewTrailEntity";
    const strokeData = createEmptyStrokeData({
      guid: "preview-trail",
      brushGuid,
      brushSize: 0.01,
      brushScale: 1,
      color,
      controlPoints: [],
    });
    this.previewTrail = {
      entity,
      mesh,
      geometry,
      geometryFamily: brushEntry?.geometryFamily ?? "unsupported",
      geometryParams: brushEntry?.geometryParams,
      generatorClass: brushEntry?.generatorClass,
      pressureSizeRange: brushEntry?.pressureSizeRange,
      pressureOpacityRange: brushEntry?.pressureOpacityRange,
      deterministicParticleBirthTime: false,
      particleKnotIndexOffset: 0,
      particleDistanceOffset: 0,
      particleBirthTimeOffsetSeconds: 0,
      geometryFinalized: false,
      toolId: "free-paint",
      groupId: 0,
      samplingMode: "freehand",
      mirrorMode: "none",
      snapMode: "none",
      lazyMode: "none",
      stencilMode: "none",
      strokeData,
      controlPoints: strokeData.controlPoints,
      lastPosition: [0, 0, 0],
      lastPointIsKeeper: false,
      lastKeeperSmoothedPressure: 0,
      solidMinLengthMeters: resolveGeneratorSolidMinLengthMeters({
        generatorClass: brushEntry?.generatorClass,
        descriptorValue: brushEntry?.geometryParams?.solidMinLengthMeters,
        geometryFamily: brushEntry?.geometryFamily ?? "unsupported",
      }),
      geometryArrays: createBrushGeometryArrays(),
      posePosition: [0, 0, 0],
      poseOrientationInv: [0, 0, 0, 1],
      poseScale: 1,
      minBounds: new Float32Array(3),
      maxBounds: new Float32Array(3),
    };
    this.previewBrushGuid = brushGuid;
    return this.previewTrail;
  }

  private resetPreviewTrailPoints(): void {
    if (this.previewTrail) {
      const points = this.previewTrail.strokeData.controlPoints;
      this.previewPointPool.push(...points);
      points.length = 0;
      this.previewTrail.mesh.visible = false;
      this.previewTrail.particleKnotIndexOffset = 0;
      this.previewTrail.particleDistanceOffset = 0;
      this.previewTrail.lastPointIsKeeper = false;
      this.previewTrail.lastKeeperSmoothedPressure = 0;
      this.previewTrail.lastPosition[0] = 0;
      this.previewTrail.lastPosition[1] = 0;
      this.previewTrail.lastPosition[2] = 0;
    }
    this.previewBirths.length = 0;
  }

  private disposePreviewTrail(): void {
    if (this.previewTrail) {
      this.previewTrail.geometry.dispose();
      this.previewTrail.entity.destroy();
      this.previewTrail = undefined;
    }
    this.previewBrushGuid = "";
    this.previewBirths.length = 0;
  }

  private finalizeActiveStroke(): void {
    const stroke = this.activeStroke;
    if (!stroke) {
      return;
    }
    stroke.geometryFinalized = true;
    this.rebuildStrokeMesh(stroke);
    if (
      ((stroke.samplingMode === "straightedge" ||
        stroke.samplingMode === "tape") &&
        stroke.controlPoints.length < 2) ||
      shouldDiscardGeneratedStroke(stroke.geometryArrays.indexCount)
    ) {
      // Materials are shared per brush GUID and must survive; dispose only
      // this stroke's geometry (entity.dispose() would kill the material for
      // every other stroke using the same brush).
      stroke.geometry.dispose();
      stroke.entity.destroy();
      this.activeStroke = undefined;
      return;
    }
    stroke.entity.setValue(BrushStroke, "finalized", true);
    stroke.entity.setValue(BrushStroke, "visible", true);
    stroke.entity.setValue(BrushStroke, "renderVisible", true);
    // Retained for sketch serialization (save/export).
    if (stroke.entity.object3D) {
      stroke.entity.object3D.userData.openBrushStrokeData = stroke.strokeData;
    }
    const strokeGroup = [stroke.entity];
    if (stroke.mirrorMode === "x" && stroke.controlPoints.length >= 2) {
      strokeGroup.push(this.createMirroredStroke(stroke));
    }
    this.strokeHistory.commit(strokeGroup);
    this.activeStroke = undefined;
    this.world.getSystem(AudioFeedbackSystem)?.playSound("stroke-end");
    if (this.onLocalStrokesCommitted) {
      const committed: StrokeData[] = [];
      for (const entity of strokeGroup) {
        const data = entity.object3D?.userData.openBrushStrokeData as
          | StrokeData
          | undefined;
        if (data) {
          committed.push(data);
        }
      }
      if (committed.length > 0) {
        this.onLocalStrokesCommitted(committed);
      }
    }
  }

  // Erase runs every held-trigger frame over every stroke in the sketch;
  // the candidate/target wrappers and hit list are reused to keep the loop
  // allocation-free.
  private readonly eraseCandidateScratch = {
    layerIndex: 0,
    finalized: false,
    visible: false,
    renderVisible: false,
    brushSize: 0,
    minBounds: undefined as unknown as Vec3,
    maxBounds: undefined as unknown as Vec3,
    boundsOffset: undefined as unknown as Vec3,
    boundsIncludeBrushWidth: true,
  };
  private readonly eraseTargetScratch = {
    value: undefined as unknown as Entity,
    candidate: this.eraseCandidateScratch,
    geometryHit: false,
  };
  private readonly erasedStrokesScratch: Entity[] = [];

  private eraseIntersectingStrokes(): void {
    const appStateEntity = this.getFirstEntity("appState");
    const activeLayerIndex = appStateEntity
      ? Number(appStateEntity.getValue(OpenBrushAppState, "activeLayerIndex"))
      : 0;
    this.writeToolCenter(this.eraserCenter, this.getEraserForwardOffset());
    const eraserRadius = this.getEraserRadius();
    const canvas = this.writeCanvasToolCenter(
      this.canvasToolCenter,
      this.eraserCenter,
    );
    const canvasEraserRadius = eraserRadius / canvas.scale;

    const erasedStrokes = this.erasedStrokesScratch;
    erasedStrokes.length = 0;
    const candidate = this.eraseCandidateScratch;
    const target = this.eraseTargetScratch;
    for (const entity of this.queries.strokes.entities) {
      candidate.layerIndex = Number(entity.getValue(BrushStroke, "layerIndex"));
      candidate.finalized = Boolean(entity.getValue(BrushStroke, "finalized"));
      candidate.visible = Boolean(entity.getValue(BrushStroke, "visible"));
      candidate.renderVisible = Boolean(
        entity.getValue(BrushStroke, "renderVisible"),
      );
      candidate.brushSize = Number(entity.getValue(BrushStroke, "brushSize"));
      candidate.minBounds = entity.getVectorView(
        BrushStroke,
        "minBounds",
      ) as unknown as Vec3;
      candidate.maxBounds = entity.getVectorView(
        BrushStroke,
        "maxBounds",
      ) as unknown as Vec3;
      candidate.boundsOffset = this.writeStrokeBoundsOffset(
        entity,
        this.strokeBoundsOffset,
      );
      target.value = entity;
      target.geometryHit = Boolean(
        this.strokeGeometryIntersectsSphere(
          entity,
          this.eraserCenter,
          eraserRadius,
        ),
      );
      if (isOpenBrushEraserHit(
        target,
        activeLayerIndex,
        canvas.center,
        canvasEraserRadius,
      )) {
        erasedStrokes.push(entity);
      }
    }

    if (erasedStrokes.length === 0) {
      if (appStateEntity && this.eraseHoldErasedCount === 0) {
        this.setToolStatus(appStateEntity, "nothing-to-erase", true);
      }
      return;
    }
    for (const entity of erasedStrokes) {
      this.setStrokeVisible(entity, false);
    }
    this.strokeHistory.commitErased(erasedStrokes);
    this.emitLocalVisibility(erasedStrokes, false);
    this.world.getSystem(AudioFeedbackSystem)?.playSoundVariant("erase");
    this.eraseHoldErasedCount += erasedStrokes.length;
    if (appStateEntity) {
      const plural = this.eraseHoldErasedCount === 1 ? "" : "s";
      this.setToolStatus(
        appStateEntity,
        `erased ${this.eraseHoldErasedCount} stroke${plural}`,
        true,
      );
    }
  }

  private getEraserRadius(): number {
    const cursor = this.getFirstEntity("eraserCursors");
    return normalizeOpenBrushEraserRadius(
      cursor ? Number(cursor.getValue(OpenBrushEraserCursor, "radius")) : NaN,
    );
  }

  private getEraserForwardOffset(): number {
    const cursor = this.getFirstEntity("eraserCursors");
    if (!cursor) {
      return OPEN_BRUSH_ERASER_FORWARD_OFFSET;
    }
    return Math.max(
      0,
      Number(cursor.getValue(OpenBrushEraserCursor, "forwardOffset")),
    );
  }

  private strokeGeometryIntersectsSphere(
    entity: Entity,
    center: Vec3,
    radius: number,
  ): boolean | undefined {
    const object = entity.object3D;
    if (
      !(object instanceof Mesh) ||
      !(object.geometry instanceof BufferGeometry)
    ) {
      return undefined;
    }

    const position = object.geometry.getAttribute("position");
    if (!position || position.count < 3) {
      return undefined;
    }
    const index = object.geometry.getIndex();
    const drawRange = object.geometry.drawRange;
    const sourceCount = index ? index.count : position.count;
    const drawCount = Number.isFinite(drawRange.count)
      ? Math.min(Math.max(0, drawRange.count), sourceCount)
      : sourceCount;
    if (drawCount < 3) {
      return undefined;
    }

    object.updateWorldMatrix(true, false);
    return indexedTriangleGeometryIntersectsSphere(
      {
        positions: position.array as ArrayLike<number>,
        indices: index?.array as ArrayLike<number> | undefined,
        drawStart: Math.max(0, Math.floor(drawRange.start)),
        drawCount,
        matrixElements: object.matrixWorld.elements,
      },
      center,
      radius,
    );
  }

  /** Refreshes the hover preview on the sphere cursor; returns the target. */
  private updateDropperHover(
    activeTool: OpenBrushToolDescriptor,
  ): Entity | undefined {
    const pickerSpec = resolveOpenBrushPickerToolSpec(activeTool.id);
    const cursor = this.getFirstEntity("eraserCursors");
    if (!pickerSpec || !cursor) {
      return undefined;
    }

    this.writeToolCenter(this.pickerCenter, pickerSpec.forwardOffset);
    const target = this.findIntersectingStroke(
      this.pickerCenter,
      pickerSpec.radius,
    );
    if (!target) {
      this.clearDropperHover();
      return undefined;
    }

    if (Boolean(cursor.getValue(OpenBrushEraserCursor, "hoverValid")) !== true) {
      cursor.setValue(OpenBrushEraserCursor, "hoverValid", true);
    }
    const hoverColor = cursor.getVectorView(
      OpenBrushEraserCursor,
      "hoverColor",
    ) as Float32Array;
    const strokeColor = target.getVectorView(BrushStroke, "color") as Float32Array;
    hoverColor[0] = strokeColor[0];
    hoverColor[1] = strokeColor[1];
    hoverColor[2] = strokeColor[2];
    hoverColor[3] = 1;
    const brushGuid = String(target.getValue(BrushStroke, "brushGuid"));
    const brushName = findBrushByGuid(openBrushInventory, brushGuid)?.name ?? "";
    if (String(cursor.getValue(OpenBrushEraserCursor, "hoverBrushName")) !== brushName) {
      cursor.setValue(OpenBrushEraserCursor, "hoverBrushName", brushName);
    }
    return target;
  }

  private clearDropperHover(): void {
    const cursor = this.getFirstEntity("eraserCursors");
    if (!cursor) {
      return;
    }
    if (Boolean(cursor.getValue(OpenBrushEraserCursor, "hoverValid"))) {
      cursor.setValue(OpenBrushEraserCursor, "hoverValid", false);
    }
  }

  /**
   * DropperTool pick: adopt the hovered stroke's brush, size, and color, then
   * exit back to the previous tool (m_RequestExit).
   */
  private pickWithDropper(
    activeTool: OpenBrushToolDescriptor,
    target: Entity | undefined,
  ): void {
    const appStateEntity = this.getFirstEntity("appState");
    const settingsEntity = this.getFirstEntity("brushSettings");
    if (!appStateEntity || !settingsEntity) {
      return;
    }

    const pickerSpec = resolveOpenBrushPickerToolSpec(activeTool.id);
    if (!pickerSpec) {
      return;
    }
    if (!target) {
      this.setToolStatus(appStateEntity, "nothing-to-pick");
      return;
    }

    const commandIndex = Number(target.getValue(BrushStroke, "commandIndex"));
    this.writeBrushSettingsSnapshot(
      settingsEntity,
      resolveOpenBrushPickerBrushSettings(
        pickerSpec,
        this.readBrushSettingsSnapshot(settingsEntity),
        this.readPickedStrokeSnapshot(target),
        openBrushInventory,
      ),
    );
    this.setToolStatus(
      appStateEntity,
      `picked ${pickerSpec.pickedStatusLabel} #${commandIndex}`,
      true,
    );
    this.clearDropperHover();
    this.world.getSystem(AudioFeedbackSystem)?.playSound("color-picked");

    const previousToolId = String(
      appStateEntity.getValue(OpenBrushAppState, "previousTool"),
    );
    const exitTool = resolveOpenBrushTool(
      previousToolId === activeTool.id ? "free-paint" : previousToolId,
    );
    appStateEntity.setValue(OpenBrushAppState, "previousTool", activeTool.id);
    appStateEntity.setValue(OpenBrushAppState, "activeTool", exitTool.id);
    appStateEntity.setValue(
      OpenBrushAppState,
      "toolRevision",
      Number(appStateEntity.getValue(OpenBrushAppState, "toolRevision")) + 1,
    );
  }

  private findIntersectingStroke(center: Vec3, radius: number): Entity | undefined {
    const appStateEntity = this.getFirstEntity("appState");
    const activeLayerIndex = appStateEntity
      ? Number(appStateEntity.getValue(OpenBrushAppState, "activeLayerIndex"))
      : 0;
    const canvas = this.writeCanvasToolCenter(this.canvasToolCenter, center);
    const canvasRadius = radius / canvas.scale;
    let target: Entity | undefined;
    let newestCommandIndex = -1;

    for (const entity of this.queries.strokes.entities) {
      const minBounds = entity.getVectorView(
        BrushStroke,
        "minBounds",
      ) as unknown as Vec3;
      const maxBounds = entity.getVectorView(
        BrushStroke,
        "maxBounds",
      ) as unknown as Vec3;
      const boundsOffset = this.writeStrokeBoundsOffset(
        entity,
        this.strokeBoundsOffset,
      );
      const commandIndex = Number(entity.getValue(BrushStroke, "commandIndex"));
      const geometryHit = this.strokeGeometryIntersectsSphere(
        entity,
        center,
        radius,
      );
      if (
        !isOpenBrushPickerHit(
          {
            value: entity,
            commandIndex,
            candidate: {
              layerIndex: Number(entity.getValue(BrushStroke, "layerIndex")),
              finalized: Boolean(entity.getValue(BrushStroke, "finalized")),
              visible: Boolean(entity.getValue(BrushStroke, "visible")),
              renderVisible: Boolean(entity.getValue(BrushStroke, "renderVisible")),
              brushSize: Number(entity.getValue(BrushStroke, "brushSize")),
              minBounds,
              maxBounds,
              boundsOffset,
              boundsIncludeBrushWidth: true,
            },
            geometryHit,
          },
          activeLayerIndex,
          canvas.center,
          canvasRadius,
        )
      ) {
        continue;
      }

      if (commandIndex > newestCommandIndex) {
        newestCommandIndex = commandIndex;
        target = entity;
      }
    }

    return target;
  }

  private writeStrokeBoundsOffset(entity: Entity, target: Vec3): Vec3 {
    // Bounds and their offsets live in canvas space (strokes sit under the
    // scene pose root), matching the canvas-space tool centers.
    const object = entity.object3D;
    if (!object) {
      target[0] = 0;
      target[1] = 0;
      target[2] = 0;
      return target;
    }
    target[0] = object.position.x;
    target[1] = object.position.y;
    target[2] = object.position.z;
    return target;
  }

  private writeToolCenter(target: Vec3, forwardOffset: number): Vec3 {
    return writeOpenBrushToolOffsetPosition(
      target,
      this.samplePosition,
      this.sampleQuaternion,
      forwardOffset,
    );
  }

  /**
   * Converts a world-space tool center into the current canvas space so the
   * stroke-bounds broadphase stays exact under the world grab; returns the
   * matching canvas-space radius via `scaleOut`.
   */
  private writeCanvasToolCenter(
    target: Vec3,
    worldCenter: Vec3,
  ): { center: Vec3; scale: number } {
    const poseObject = this.getFirstEntity("scenePoses")?.object3D;
    if (!poseObject) {
      target[0] = worldCenter[0];
      target[1] = worldCenter[1];
      target[2] = worldCenter[2];
      return { center: target, scale: 1 };
    }
    const scale = poseObject.scale.x || 1;
    this.poseQuaternionInv.copy(poseObject.quaternion).invert();
    this.canvasPosition
      .set(worldCenter[0], worldCenter[1], worldCenter[2])
      .sub(poseObject.position)
      .applyQuaternion(this.poseQuaternionInv)
      .divideScalar(scale);
    target[0] = this.canvasPosition.x;
    target[1] = this.canvasPosition.y;
    target[2] = this.canvasPosition.z;
    return { center: target, scale };
  }

  private readBrushSettingsSnapshot(
    settingsEntity: Entity,
  ): OpenBrushBrushSettingsSnapshot {
    const color = settingsEntity.getVectorView(
      BrushSettings,
      "color",
    ) as Float32Array;
    return {
      brushGuid: String(settingsEntity.getValue(BrushSettings, "brushGuid")),
      size01: Number(settingsEntity.getValue(BrushSettings, "size01")),
      size: Number(settingsEntity.getValue(BrushSettings, "size")),
      color: [color[0], color[1], color[2], color[3]],
    };
  }

  private readPickedStrokeSnapshot(
    strokeEntity: Entity,
  ): OpenBrushPickedStrokeSnapshot {
    const color = strokeEntity.getVectorView(
      BrushStroke,
      "color",
    ) as Float32Array;
    // Stroke sizes are stored in canvas units; the dropper adopts the room
    // size (DropperTool uses stroke.SizeInRoomSpace).
    const poseScale = this.getFirstEntity("scenePoses")?.object3D?.scale.x || 1;
    return {
      brushGuid: String(strokeEntity.getValue(BrushStroke, "brushGuid")),
      brushSize:
        Number(strokeEntity.getValue(BrushStroke, "brushSize")) * poseScale,
      color: [color[0], color[1], color[2], color[3]],
    };
  }

  private writeBrushSettingsSnapshot(
    settingsEntity: Entity,
    snapshot: OpenBrushBrushSettingsSnapshot,
  ): void {
    settingsEntity.setValue(BrushSettings, "brushGuid", snapshot.brushGuid);
    settingsEntity.setValue(BrushSettings, "size01", snapshot.size01);
    settingsEntity.setValue(
      BrushSettings,
      "size",
      snapshot.size,
    );
    const color = settingsEntity.getVectorView(
      BrushSettings,
      "color",
    ) as Float32Array;
    color[0] = snapshot.color[0];
    color[1] = snapshot.color[1];
    color[2] = snapshot.color[2];
    color[3] = snapshot.color[3];
  }

  private setToolStatus(
    appStateEntity: Entity,
    status: string,
    forceRevision = false,
  ): void {
    if (
      String(appStateEntity.getValue(OpenBrushAppState, "toolStatus")) === status
    ) {
      if (forceRevision) {
        this.touchToolState(appStateEntity);
      }
      return;
    }
    appStateEntity.setValue(OpenBrushAppState, "toolStatus", status);
    this.touchToolState(appStateEntity);
  }

  private setPanelFocusStatus(
    appStateEntity: Entity | undefined,
    activeTool: OpenBrushToolDescriptor,
  ): void {
    if (!appStateEntity) {
      return;
    }
    this.setToolStatus(
      appStateEntity,
      resolveOpenBrushPanelFocusStatus(activeTool),
    );
  }

  private clearPanelFocusStatus(
    appStateEntity: Entity | undefined,
    activeTool: OpenBrushToolDescriptor,
  ): void {
    if (!appStateEntity) {
      return;
    }
    const currentStatus = String(
      appStateEntity.getValue(OpenBrushAppState, "toolStatus"),
    );
    if (isOpenBrushPanelFocusStatus(currentStatus)) {
      this.setToolStatus(appStateEntity, activeTool.status);
    }
  }

  private touchToolState(appStateEntity: Entity): void {
    appStateEntity.setValue(
      OpenBrushAppState,
      "toolRevision",
      Number(appStateEntity.getValue(OpenBrushAppState, "toolRevision")) + 1,
    );
    appStateEntity.setValue(
      OpenBrushAppState,
      "commandRevision",
      Number(appStateEntity.getValue(OpenBrushAppState, "commandRevision")) + 1,
    );
  }

  /**
   * Rebuilds a stroke entity from serialized data (sketch load). The
   * geometry is generated once; the entity starts hidden so load transitions
   * can stagger it in.
   */
  spawnStrokeFromData(strokeData: StrokeData, startVisible = false): Entity {
    return this.buildStrokeRuntimeFromData(strokeData, startVisible).entity;
  }

  /**
   * Creates or updates a peer's in-progress stroke (collab mode). Progress
   * messages carry the whole stroke, so updates simply replace the data and
   * rebuild — lost updates self-heal on the next one.
   */
  upsertRemoteStroke(strokeData: StrokeData): void {
    const existing = this.remoteActiveStrokes.get(strokeData.guid);
    if (!existing) {
      // Reconnect resyncs replay strokes we may already hold — GUIDs are
      // author-unique, so an existing finalized copy wins (its local
      // visibility included).
      for (const entity of this.queries.strokes.entities) {
        if (String(entity.getValue(BrushStroke, "guid")) === strokeData.guid) {
          return;
        }
      }
      const newestRemotePoint =
        strokeData.controlPoints[strokeData.controlPoints.length - 1];
      const newestRemoteTimestampSeconds =
        (newestRemotePoint?.timestampMs ?? 0) * 0.001;
      const runtime = this.buildStrokeRuntimeFromData(
        strokeData,
        true,
        false,
        this.currentLevelTimeSeconds - newestRemoteTimestampSeconds,
      );
      this.remoteActiveStrokes.set(strokeData.guid, runtime);
      return;
    }
    existing.strokeData = strokeData;
    existing.controlPoints = strokeData.controlPoints;
    existing.entity.setValue(
      BrushStroke,
      "controlPointCount",
      strokeData.controlPoints.length,
    );
    if (existing.entity.object3D) {
      existing.entity.object3D.userData.openBrushStrokeData = strokeData;
    }
    this.recalculateBounds(existing);
    this.rebuildStrokeMesh(existing);
  }

  /** Replaces the in-progress remote stroke with its final authoritative data. */
  finalizeRemoteStroke(strokeData: StrokeData): void {
    this.upsertRemoteStroke(strokeData);
    const runtime = this.remoteActiveStrokes.get(strokeData.guid);
    if (runtime) {
      runtime.geometryFinalized = true;
      runtime.lastPointIsKeeper = false;
      this.rebuildStrokeMesh(runtime);
      runtime.entity.setValue(BrushStroke, "finalized", true);
      this.remoteActiveStrokes.delete(strokeData.guid);
    }
  }

  /** The peer discarded their in-progress stroke. */
  dropRemoteStroke(guid: string): void {
    const runtime = this.remoteActiveStrokes.get(guid);
    if (!runtime) {
      return;
    }
    this.remoteActiveStrokes.delete(guid);
    runtime.geometry.dispose();
    runtime.entity.destroy();
  }

  /** Applies a peer's erase/undo/redo without echoing it back. */
  applyRemoteVisibility(guids: readonly string[], visible: boolean): number {
    const wanted = new Set(guids);
    let applied = 0;
    for (const entity of this.queries.strokes.entities) {
      if (wanted.has(String(entity.getValue(BrushStroke, "guid")))) {
        this.setStrokeVisible(entity, visible);
        applied += 1;
      }
    }
    return applied;
  }

  /** The local in-progress stroke, for the collab progress broadcast. */
  getActiveLocalStrokeData(): StrokeData | undefined {
    return this.activeStroke?.strokeData;
  }

  /** Forget remote in-progress bookkeeping (entities are torn down elsewhere). */
  clearRemoteActiveStrokes(): void {
    this.remoteActiveStrokes.clear();
  }

  private buildStrokeRuntimeFromData(
    strokeData: StrokeData,
    startVisible: boolean,
    finalized = true,
    particleBirthTimeOffsetSeconds = 0,
  ): RuntimeStroke {
    this.strokeCounter += 1;
    const brushEntry = findBrushByGuid(openBrushInventory, strokeData.brushGuid);
    const geometryFamily = brushEntry?.geometryFamily ?? "unsupported";
    const materialSpec = createBrushMaterialSpec(brushEntry, strokeData.color);
    const geometry = new BufferGeometry();
    const material = this.createStrokeRenderMaterial(
      brushEntry,
      materialSpec,
      strokeData.color[3],
    );
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = `OpenBrushStrokeMesh_${this.strokeCounter}`;

    const poseEntity = this.getFirstEntity("scenePoses");
    const entity = poseEntity
      ? this.world.createTransformEntity(mesh, poseEntity)
      : this.world.createTransformEntity(mesh);
    entity.object3D!.name = `OpenBrushStroke_${this.strokeCounter}`;
    entity.object3D!.userData.openBrushStrokeData = strokeData;
    entity.addComponent(BrushStroke, {
      guid: strokeData.guid,
      brushGuid: strokeData.brushGuid,
      toolId: "free-paint",
      groupId: strokeData.groupId,
      groupContinuation: false,
      geometryFamily,
      materialFamily: materialSpec.materialFamily,
      renderWarning: materialSpec.warning ?? "",
      layerIndex: strokeData.layerIndex,
      brushSize: strokeData.brushSize,
      color: strokeData.color,
      finalized,
      visible: startVisible,
      renderVisible: startVisible,
      selected: false,
      controlPointCount: strokeData.controlPoints.length,
      vertexCount: 0,
      indexCount: 0,
      commandIndex: this.strokeCounter,
    });
    if (!startVisible && entity.object3D) {
      entity.object3D.visible = false;
    }

    const runtime: RuntimeStroke = {
      entity,
      mesh,
      geometry,
      geometryFamily,
      geometryParams: brushEntry?.geometryParams,
      generatorClass: brushEntry?.generatorClass,
      pressureSizeRange: brushEntry?.pressureSizeRange,
      pressureOpacityRange: brushEntry?.pressureOpacityRange,
      deterministicParticleBirthTime: finalized,
      particleKnotIndexOffset: 0,
      particleDistanceOffset: 0,
      particleBirthTimeOffsetSeconds,
      geometryFinalized: finalized,
      toolId: "free-paint",
      groupId: strokeData.groupId,
      samplingMode: "freehand",
      mirrorMode: "none",
      snapMode: "none",
      lazyMode: "none",
      stencilMode: "none",
      strokeData,
      controlPoints: strokeData.controlPoints,
      lastPosition: [0, 0, 0],
      lastPointIsKeeper: finalized,
      lastKeeperSmoothedPressure: 0,
      solidMinLengthMeters: resolveGeneratorSolidMinLengthMeters({
        generatorClass: brushEntry?.generatorClass,
        descriptorValue: brushEntry?.geometryParams?.solidMinLengthMeters,
        geometryFamily,
      }),
      geometryArrays: createBrushGeometryArrays(),
      posePosition: [0, 0, 0],
      poseOrientationInv: [0, 0, 0, 1],
      poseScale: 1,
      minBounds: entity.getVectorView(BrushStroke, "minBounds") as Float32Array,
      maxBounds: entity.getVectorView(BrushStroke, "maxBounds") as Float32Array,
    };
    this.recalculateBounds(runtime);
    this.rebuildStrokeMesh(runtime);
    return runtime;
  }

  private createMirroredStroke(source: RuntimeStroke): Entity {
    this.strokeCounter += 1;
    const guid = `runtime-stroke-${this.strokeCounter}`;
    const strokeData = createMirroredStrokeDataX(source.strokeData, {
      guid,
      seed: this.strokeCounter,
      groupId: source.groupId,
    });
    const brushEntry = findBrushByGuid(openBrushInventory, strokeData.brushGuid);
    const materialSpec = createBrushMaterialSpec(brushEntry, strokeData.color);
    const geometry = new BufferGeometry();
    const material = this.createStrokeRenderMaterial(
      brushEntry,
      materialSpec,
      strokeData.color[3],
    );
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = `OpenBrushStrokeMesh_${this.strokeCounter}`;

    const poseEntity = this.getFirstEntity("scenePoses");
    const entity = poseEntity
      ? this.world.createTransformEntity(mesh, poseEntity)
      : this.world.createTransformEntity(mesh);
    entity.object3D!.name = `OpenBrushStroke_${this.strokeCounter}`;
    entity.object3D!.userData.openBrushStrokeData = strokeData;
    entity.addComponent(BrushStroke, {
      guid,
      brushGuid: strokeData.brushGuid,
      toolId: source.toolId,
      groupId: source.groupId,
      groupContinuation: true,
      geometryFamily: source.geometryFamily,
      materialFamily: materialSpec.materialFamily,
      renderWarning: materialSpec.warning ?? "",
      layerIndex: strokeData.layerIndex,
      brushSize: strokeData.brushSize,
      color: strokeData.color,
      finalized: true,
      visible: true,
      renderVisible: true,
      selected: false,
      controlPointCount: strokeData.controlPoints.length,
      vertexCount: 0,
      indexCount: 0,
      commandIndex: this.strokeCounter,
    });

    const mirroredStroke: RuntimeStroke = {
      entity,
      mesh,
      geometry,
      geometryFamily: source.geometryFamily,
      geometryParams: brushEntry?.geometryParams,
      generatorClass: brushEntry?.generatorClass,
      pressureSizeRange: brushEntry?.pressureSizeRange,
      pressureOpacityRange: brushEntry?.pressureOpacityRange,
      deterministicParticleBirthTime: source.deterministicParticleBirthTime,
      particleKnotIndexOffset: source.particleKnotIndexOffset,
      particleDistanceOffset: source.particleDistanceOffset,
      particleBirthTimeOffsetSeconds: source.particleBirthTimeOffsetSeconds,
      geometryFinalized: true,
      toolId: source.toolId,
      groupId: source.groupId,
      samplingMode: source.samplingMode,
      mirrorMode: "none",
      snapMode: "none",
      lazyMode: "none",
      stencilMode: source.stencilMode,
      strokeData,
      controlPoints: strokeData.controlPoints,
      lastPosition: [0, 0, 0],
      lastPointIsKeeper: source.lastPointIsKeeper,
      lastKeeperSmoothedPressure: 0,
      solidMinLengthMeters: resolveGeneratorSolidMinLengthMeters({
        generatorClass: brushEntry?.generatorClass,
        descriptorValue: brushEntry?.geometryParams?.solidMinLengthMeters,
        geometryFamily: source.geometryFamily,
      }),
      geometryArrays: createBrushGeometryArrays(),
      posePosition: [
        source.posePosition[0],
        source.posePosition[1],
        source.posePosition[2],
      ],
      poseOrientationInv: [
        source.poseOrientationInv[0],
        source.poseOrientationInv[1],
        source.poseOrientationInv[2],
        source.poseOrientationInv[3],
      ],
      poseScale: source.poseScale,
      minBounds: entity.getVectorView(BrushStroke, "minBounds") as Float32Array,
      maxBounds: entity.getVectorView(BrushStroke, "maxBounds") as Float32Array,
    };
    this.recalculateBounds(mirroredStroke);
    this.rebuildStrokeMesh(mirroredStroke);
    return entity;
  }

  /**
   * Forget all undo/redo history without disposing entities — the sketch
   * library destroys stroke entities itself (brush materials are shared per
   * GUID and must survive).
   */
  resetStrokeHistory(): void {
    this.strokeHistory.forgetAll();
  }

  private undoLastStroke(): void {
    const operation = this.strokeHistory.undoOperation();
    if (!operation) {
      return;
    }
    const visible = operation.kind === "erase";
    for (const entity of operation.group) {
      this.setStrokeVisible(entity, visible);
    }
    this.emitLocalVisibility(operation.group, visible);
    this.world.getSystem(AudioFeedbackSystem)?.playSoundVariant("undo");
  }

  private redoLastStroke(): void {
    const operation = this.strokeHistory.redoOperation();
    if (!operation) {
      return;
    }
    const visible = operation.kind === "create";
    for (const entity of operation.group) {
      this.setStrokeVisible(entity, visible);
    }
    this.emitLocalVisibility(operation.group, visible);
    this.world.getSystem(AudioFeedbackSystem)?.playSoundVariant("redo");
  }

  private emitLocalVisibility(entities: readonly Entity[], visible: boolean): void {
    if (!this.onLocalStrokeVisibility || entities.length === 0) {
      return;
    }
    const guids: string[] = [];
    for (const entity of entities) {
      const guid = String(entity.getValue(BrushStroke, "guid"));
      if (guid) {
        guids.push(guid);
      }
    }
    if (guids.length > 0) {
      this.onLocalStrokeVisibility(guids, visible);
    }
  }

  private consumeStrokeHistoryRequests(appState: Entity | undefined): void {
    if (!appState) {
      return;
    }

    const undoRevision = Math.trunc(
      Number(appState.getValue(OpenBrushAppState, "strokeUndoRequestRevision")),
    );
    if (
      Number.isFinite(undoRevision) &&
      undoRevision > this.consumedStrokeUndoRequestRevision
    ) {
      this.consumedStrokeUndoRequestRevision = undoRevision;
      this.undoLastStroke();
    }

    const redoRevision = Math.trunc(
      Number(appState.getValue(OpenBrushAppState, "strokeRedoRequestRevision")),
    );
    if (
      Number.isFinite(redoRevision) &&
      redoRevision > this.consumedStrokeRedoRequestRevision
    ) {
      this.consumedStrokeRedoRequestRevision = redoRevision;
      this.redoLastStroke();
    }
  }

  private setStrokeVisible(entity: Entity, visible: boolean): void {
    entity.setValue(BrushStroke, "visible", visible);
    entity.setValue(BrushStroke, "renderVisible", visible);
    if (!visible) {
      entity.setValue(BrushStroke, "selected", false);
    }
    if (entity.object3D) {
      entity.object3D.visible = visible;
    }
  }

  private samplePointerPose(
    commandEntity: Entity,
    activeTool: OpenBrushToolDescriptor,
  ): void {
    const hand = this.resolveBrushPointerHand(commandEntity);
    const source = String(commandEntity.getValue(InputCommandState, "source"));
    const leftControllerConnected = Boolean(
      commandEntity.getValue(InputCommandState, "leftControllerConnected"),
    );
    const rightControllerConnected = Boolean(
      commandEntity.getValue(InputCommandState, "rightControllerConnected"),
    );
    if (
      hand === "left" &&
      source !== "browser-pointer" &&
      source !== "keyboard" &&
      leftControllerConnected
    ) {
      this.sampleXrPointerPose("left");
    } else if (
      hand === "right" &&
      source !== "browser-pointer" &&
      source !== "keyboard" &&
      rightControllerConnected
    ) {
      this.sampleXrPointerPose("right");
    } else {
      this.sampleBrowserPointerPose(commandEntity);
    }

    this.writeSampledBrushPointerState(hand, activeTool);
  }

  private resolveBrushPointerHand(commandEntity: Entity): BrushPointerHand {
    const commandHand = String(
      commandEntity.getValue(InputCommandState, "primaryHand"),
    );
    if (commandHand === "left" || commandHand === "right") {
      return commandHand;
    }
    const settings = this.getFirstEntity("settings");
    return String(settings?.getValue(SettingsState, "dominantHand")) === "left"
      ? "left"
      : "right";
  }

  private sampleXrPointerPose(hand: BrushPointerHand): void {
    // The tip anchor IS the tool attach point (grip space + tuned offset —
    // Quest browser workaround for bad target-ray-space poses).
    const anchorObject = this.getTipAnchorObject(hand);
    if (!anchorObject) {
      return;
    }
    anchorObject.getWorldPosition(this.panelRayPosition);
    anchorObject.getWorldQuaternion(this.panelRayQuaternion);
    this.sampleQuaternion.copy(this.panelRayQuaternion);
    this.rayDirection
      .set(0, 0, -1)
      .applyQuaternion(this.panelRayQuaternion);
    this.samplePosition.copy(this.panelRayPosition);
  }

  private getTipAnchorObject(
    hand: BrushPointerHand,
  ): NonNullable<Entity["object3D"]> | undefined {
    for (const anchor of this.queries.tipAnchors.entities) {
      if (
        String(anchor.getValue(OpenBrushTipAnchor, "hand")) === hand &&
        anchor.object3D
      ) {
        return anchor.object3D;
      }
    }
    return undefined;
  }

  private sampleBrowserPointerPose(commandEntity: Entity): void {
    const canvas = this.world.renderer.domElement;
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    const pointerX = Number(commandEntity.getValue(InputCommandState, "pointerX"));
    const pointerY = Number(commandEntity.getValue(InputCommandState, "pointerY"));
    const hasPointer = pointerX !== 0 || pointerY !== 0;
    const normalizedX = hasPointer ? pointerX / width : 0.5;
    const normalizedY = hasPointer ? pointerY / height : 0.5;

    this.sampleNdc.set(normalizedX * 2 - 1, -(normalizedY * 2 - 1), 0.5);
    this.sampleNdc.unproject(this.world.camera);
    this.world.camera.getWorldPosition(this.cameraPosition);
    this.sampleDirection
      .copy(this.sampleNdc)
      .sub(this.cameraPosition)
      .normalize();
    this.samplePosition
      .copy(this.cameraPosition)
      .addScaledVector(this.sampleDirection, 1.5);
    this.world.camera.getWorldQuaternion(this.sampleQuaternion);
    this.panelRayPosition.copy(this.cameraPosition);
    this.panelRayQuaternion.copy(this.sampleQuaternion);
  }

  private getBrushColor(settingsEntity: Entity | undefined): Rgba {
    if (!settingsEntity) {
      return [1, 1, 1, 1];
    }
    const colorView = settingsEntity.getVectorView(
      BrushSettings,
      "color",
    ) as Float32Array;
    return [colorView[0], colorView[1], colorView[2], colorView[3]];
  }

  private writeSampleFrame(
    time: number,
    pressure: number,
    stroke: RuntimeStroke,
  ): StrokePointerFrame {
    this.sampleFrame.pressure = pressure;
    this.writeCanvasSpacePose(stroke, this.samplePosition, this.sampleQuaternion);
    this.sampleFrame.position[0] = this.canvasPosition.x;
    this.sampleFrame.position[1] = this.canvasPosition.y;
    this.sampleFrame.position[2] = this.canvasPosition.z;
    if (stroke.lazyMode === "position" && stroke.controlPoints.length > 0) {
      writeLazyInputPosition(
        this.sampleFrame.position,
        stroke.lastPosition,
        this.sampleFrame.position,
        LAZY_INPUT_RADIUS,
      );
    }
    if (stroke.snapMode === "grid") {
      writeGridSnappedPosition(
        this.sampleFrame.position,
        this.sampleFrame.position,
        GRID_SNAP_SIZE,
      );
    }
    if (stroke.stencilMode === "front-plane") {
      writeStencilPlaneProjectedPosition(
        this.sampleFrame.position,
        this.sampleFrame.position,
        "z",
        STENCIL_FRONT_PLANE_Z,
      );
    }
    this.sampleFrame.orientation[0] = this.canvasQuaternion.x;
    this.sampleFrame.orientation[1] = this.canvasQuaternion.y;
    this.sampleFrame.orientation[2] = this.canvasQuaternion.z;
    this.sampleFrame.orientation[3] = this.canvasQuaternion.w;
    this.sampleFrame.timestampMs = Math.round(time * 1000);
    return this.sampleFrame;
  }

  /** Converts a world-space pointer pose into the stroke's canvas space. */
  private writeCanvasSpacePose(
    stroke: RuntimeStroke,
    worldPosition: Vector3,
    worldQuaternion: Quaternion,
  ): void {
    this.poseQuaternionInv.set(
      stroke.poseOrientationInv[0],
      stroke.poseOrientationInv[1],
      stroke.poseOrientationInv[2],
      stroke.poseOrientationInv[3],
    );
    this.canvasPosition
      .copy(worldPosition)
      .sub(
        this.poseOriginScratch.set(
          stroke.posePosition[0],
          stroke.posePosition[1],
          stroke.posePosition[2],
        ),
      )
      .applyQuaternion(this.poseQuaternionInv)
      .divideScalar(stroke.poseScale);
    this.canvasQuaternion
      .copy(this.poseQuaternionInv)
      .multiply(worldQuaternion);
  }

  private writeTapeAnchorFrame(
    time: number,
    pressure: number,
  ): StrokePointerFrame {
    this.world.player.gripSpaces.left.getWorldPosition(this.tapeAnchorPosition);
    this.world.player.gripSpaces.left.getWorldQuaternion(
      this.tapeAnchorQuaternion,
    );
    this.tapeAnchorFrame.pressure = pressure;
    this.tapeAnchorFrame.position[0] = this.tapeAnchorPosition.x;
    this.tapeAnchorFrame.position[1] = this.tapeAnchorPosition.y;
    this.tapeAnchorFrame.position[2] = this.tapeAnchorPosition.z;
    this.tapeAnchorFrame.orientation[0] = this.tapeAnchorQuaternion.x;
    this.tapeAnchorFrame.orientation[1] = this.tapeAnchorQuaternion.y;
    this.tapeAnchorFrame.orientation[2] = this.tapeAnchorQuaternion.z;
    this.tapeAnchorFrame.orientation[3] = this.tapeAnchorQuaternion.w;
    this.tapeAnchorFrame.timestampMs = Math.round(time * 1000);
    return this.tapeAnchorFrame;
  }

  private getActiveTool(): OpenBrushToolDescriptor {
    const appStateEntity = this.getFirstEntity("appState");
    return resolveEffectiveOpenBrushTool(
      appStateEntity
        ? String(appStateEntity.getValue(OpenBrushAppState, "activeTool"))
        : "free-paint",
      appStateEntity
        ? Boolean(appStateEntity.getValue(OpenBrushAppState, "straightEdgeEnabled"))
        : false,
    );
  }

  private setActivePointerSampleCount(commandEntity: Entity): void {
    const hand = String(commandEntity.getValue(InputCommandState, "primaryHand"));
    for (const entity of this.queries.pointers.entities) {
      if (String(entity.getValue(BrushPointer, "hand")) === hand) {
        entity.setValue(BrushPointer, "sampleCount", 0);
      }
    }
  }

  private setPointerSampleCount(sampleCount: number): void {
    for (const entity of this.queries.pointers.entities) {
      if (entity.getValue(BrushPointer, "isDrawing")) {
        entity.setValue(BrushPointer, "sampleCount", sampleCount);
      }
    }
  }

  private writeSampledBrushPointerState(
    hand: BrushPointerHand,
    activeTool: OpenBrushToolDescriptor,
  ): void {
    for (const entity of this.queries.pointers.entities) {
      if (String(entity.getValue(BrushPointer, "hand")) !== hand) {
        continue;
      }
      entity.setValue(BrushPointer, "tool", activeTool.id);
      const position = entity.getVectorView(Transform, "position") as Float32Array;
      position[0] = this.samplePosition.x;
      position[1] = this.samplePosition.y;
      position[2] = this.samplePosition.z;
      const orientation = entity.getVectorView(
        Transform,
        "orientation",
      ) as Float32Array;
      orientation[0] = this.sampleQuaternion.x;
      orientation[1] = this.sampleQuaternion.y;
      orientation[2] = this.sampleQuaternion.z;
      orientation[3] = this.sampleQuaternion.w;
    }
  }

  private updateHistoryState(): void {
    for (const entity of this.queries.history.entities) {
      entity.setValue(
        StrokeHistoryState,
        "undoDepth",
        this.strokeHistory.undoDepth,
      );
      entity.setValue(
        StrokeHistoryState,
        "redoDepth",
        this.strokeHistory.redoDepth,
      );
      entity.setValue(
        StrokeHistoryState,
        "totalStrokeCount",
        this.strokeCounter,
      );
      entity.setValue(
        StrokeHistoryState,
        "activeStrokeControlPoints",
        this.activeStroke?.controlPoints.length ?? 0,
      );
    }
  }

  private getFirstEntity(
    queryName:
      | "commands"
      | "appState"
      | "brushSettings"
      | "eraserCursors"
      | "scenePoses"
      | "tipAnchors"
      | "settings",
  ): Entity | undefined {
    const next = this.queries[queryName].entities.values().next();
    return next.done ? undefined : next.value;
  }
}
