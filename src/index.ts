import "./three-workarounds.js";

import { SessionMode, VisibilityState, World } from "@iwsdk/core";
import { AnimatedController } from "@iwsdk/xr-input";
import * as horizonKit from "@pmndrs/uikit-horizon";
import {
  BrushIcon,
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EraserIcon,
  HouseIcon,
  MinusIcon,
  PaintbrushIcon,
  PaletteIcon,
  PipetteIcon,
  PlusIcon,
  Redo2Icon,
  RulerIcon,
  SaveIcon,
  Share2Icon,
  SwatchBookIcon,
  Undo2Icon,
  UsersIcon,
} from "@pmndrs/uikit-lucide";

import { PanelUI, RayInteractable } from "@iwsdk/core";

import { OpenBrushDebug } from "./components/debug.js";
import {
  OpenBrushBrushPage,
  OpenBrushPanelAttachment,
} from "./components/core.js";

import { PanelSystem } from "./systems/panel-system.js";

import { initialLoad } from "./app/initial-load.js";
import { raiseEcsEntityCapacity } from "./app/ecs-entity-capacity.js";
import { setupLoadingScreen } from "./app/loading-screen.js";
import { setupOpenBrushShell } from "./app/setup-shell.js";
import { version } from "../package.json";

import { AudioFeedbackSystem } from "./systems/audio-feedback-system.js";
import { BrushAudioSystem } from "./systems/brush-audio-system.js";
import { BrushMaterialUpgradeSystem } from "./systems/brush-material-upgrade-system.js";
import { BrushCatalogSystem } from "./systems/brush-catalog-system.js";
import { BrushPageSystem } from "./systems/brush-page-system.js";
import { ColorPickerSystem } from "./systems/color-picker-system.js";
import { BrushSizeInputSystem } from "./systems/brush-size-input-system.js";
import { CameraToolSystem } from "./systems/camera-tool-system.js";
import { CollabSystem } from "./systems/collab-system.js";
import { BrushPointerVisualSystem } from "./systems/brush-pointer-visual-system.js";
import { EraserCursorSystem } from "./systems/eraser-cursor-system.js";
import { InputCommandSystem } from "./systems/input-command-system.js";
import { IntroSketchSystem } from "./systems/intro-sketch-system.js";
import { LayerCanvasSystem } from "./systems/layer-canvas-system.js";
import { PanelAttachmentSystem } from "./systems/panel-attachment-system.js";
import { PerformanceCounterSystem } from "./systems/performance-counter-system.js";
import { RuntimeDebugSystem } from "./systems/runtime-debug-system.js";
import { SelectionSystem } from "./systems/selection-system.js";
import { SketchLibrarySystem } from "./systems/sketch-library-system.js";
import { StandardEnvironmentSystem } from "./systems/standard-environment-system.js";
import { StrokeAuthoringSystem } from "./systems/stroke-authoring-system.js";
import { WorldGrabSystem } from "./systems/world-grab-system.js";
import { WorldGrabVisualsSystem } from "./systems/world-grab-visuals-system.js";

AnimatedController.useSimpleMaterial = true;

// The overlay markup is in index.html so it paints before the bundle runs;
// this hooks its progress bar up to the initial-load tracker.
setupLoadingScreen();

// Must run before World.create: lifts the elics default of 1000 entities so
// stroke-heavy .tilt sketches can spawn every stroke (Open Brush has no such
// limit). See src/app/ecs-entity-capacity.ts.
raiseEcsEntityCapacity();

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    features: { handTracking: true, layers: true },
  },
  features: {
    locomotion: false,
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: false,
    spatialUI: {
      // No 2D interaction: the landing page is view-only (drawing and all
      // panels are in-session; offer:"always" provides Enter XR).
      forwardHtmlEvents: false,
      preferredColorScheme: "dark",
      kits: [
        horizonKit,
        {
          BrushIcon,
          CameraIcon,
          ChevronLeftIcon,
          ChevronRightIcon,
          EraserIcon,
          HouseIcon,
          MinusIcon,
          PaintbrushIcon,
          PaletteIcon,
          PipetteIcon,
          PlusIcon,
          Redo2Icon,
          RulerIcon,
          SaveIcon,
          Share2Icon,
          SwatchBookIcon,
          Undo2Icon,
          UsersIcon,
        },
      ],
    },
  },
}).then((world) => {
  initialLoad.complete("world");

  const { camera } = world;

  // Browser view: stand on the stage at eye height, facing the intro sketch
  // signage head-on like the in-headset welcome view.
  camera.position.set(0, 1.3, 1);
  camera.rotateX(-0.08);

  setupOpenBrushShell(world);

  // Plain HTML Enter VR button: the DOM click carries the user activation
  // that XR session requests need, so it can call launchXR() directly.
  // Hidden while immersive; offer:"always" still covers browsers with
  // native Enter-VR UI.
  const enterVrButton = document.getElementById("enter-vr-button");
  const landingFooter = document.getElementById("landing-footer");
  const landingVersion = document.getElementById("landing-version");
  if (landingVersion) {
    landingVersion.textContent = `v${version}`;
  }
  if (enterVrButton) {
    enterVrButton.addEventListener("click", () => {
      world.launchXR();
    });
    // The landing chrome waits for both the non-immersive view and the
    // initial assets — the loading screen owns the viewport until then.
    let nonImmersive = false;
    let assetsReady = initialLoad.done;
    const applyLandingChrome = () => {
      const show = nonImmersive && assetsReady;
      enterVrButton.style.display = show ? "block" : "none";
      if (landingFooter) {
        landingFooter.style.display = show ? "flex" : "none";
      }
    };
    world.visibilityState.subscribe((state) => {
      nonImmersive = state === VisibilityState.NonImmersive;
      applyLandingChrome();
    });
    void initialLoad.whenDone.then(() => {
      assetsReady = true;
      applyLandingChrome();
    });
  }

  const wandPanelPrism = world
    .createTransformEntity()
    .addComponent(OpenBrushPanelAttachment, {
      role: "prism",
      mode: "fixed-ring",
    });
  wandPanelPrism.object3D!.name = "OpenBrushWandPanelPrism";
  wandPanelPrism.object3D!.visible = false;

  // The color slot is a custom 3D panel (ColorPickerSystem); the other wand
  // slots are UIKit panels.
  for (const panel of [
    {
      role: "tools",
      config: "./ui/wand-tools.json",
      name: "OpenBrushWandToolsPanel",
    },
    {
      role: "brush",
      config: "./ui/wand-brush.json",
      name: "OpenBrushWandBrushPanel",
    },
  ] as const) {
    const wandPanel = world
      .createTransformEntity()
      .addComponent(PanelUI, {
        config: panel.config,
        maxHeight: 0.42,
        maxWidth: 0.42,
      })
      .addComponent(OpenBrushPanelAttachment, {
        role: panel.role,
        mode: "fixed-ring",
      })
      .addComponent(RayInteractable);
    if (panel.role === "brush") {
      wandPanel.addComponent(OpenBrushBrushPage);
    }
    wandPanel.object3D!.name = panel.name;
    wandPanel.object3D!.visible = false;
  }

  const debugEntity = world.createTransformEntity();
  debugEntity.object3D!.name = "OpenBrushRuntimeDebug";
  debugEntity.addComponent(OpenBrushDebug);

  world
    .registerSystem(PanelSystem)
    .registerSystem(PanelAttachmentSystem)
    .registerSystem(InputCommandSystem)
    .registerSystem(BrushSizeInputSystem)
    .registerSystem(AudioFeedbackSystem)
    .registerSystem(BrushAudioSystem)
    .registerSystem(BrushCatalogSystem)
    .registerSystem(BrushPageSystem)
    .registerSystem(ColorPickerSystem)
    .registerSystem(CameraToolSystem)
    .registerSystem(EraserCursorSystem)
    .registerSystem(LayerCanvasSystem)
    .registerSystem(WorldGrabSystem)
    .registerSystem(WorldGrabVisualsSystem)
    .registerSystem(StandardEnvironmentSystem)
    .registerSystem(IntroSketchSystem)
    .registerSystem(StrokeAuthoringSystem)
    .registerSystem(BrushMaterialUpgradeSystem)
    .registerSystem(BrushPointerVisualSystem)
    .registerSystem(SelectionSystem)
    .registerSystem(SketchLibrarySystem)
    .registerSystem(CollabSystem)
    .registerSystem(PerformanceCounterSystem)
    .registerSystem(RuntimeDebugSystem);

  // Share links: brushspace.example/?join=123456 joins straight into the
  // peer's sketch (the in-VR path uses the keypad on the tools panel).
  const joinCode = new URLSearchParams(window.location.search).get("join");
  if (joinCode) {
    const collab = world.getSystem(CollabSystem);
    if (collab) {
      collab.autoJoinCode = joinCode;
    }
  }
});
