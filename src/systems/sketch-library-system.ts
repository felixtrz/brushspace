import {
  PanelDocument,
  PanelUI,
  PerspectiveCamera,
  RayInteractable,
  UIKitDocument,
  VisibilityState,
  WebGLRenderTarget,
  createSystem,
} from "@iwsdk/core";
import type { Entity } from "@iwsdk/core";

import {
  BrushStroke,
  CanvasLayer,
  OpenBrushAppState,
  PersistenceState,
  SettingsState,
} from "../components/core.js";
import {
  IndexedDbSketchCatalogStore,
  MemorySketchCatalogStore,
  createSketchCatalogRecord,
  readSketchCatalogRecordDocument,
  type SketchCatalogListItem,
  type SketchCatalogStore,
} from "../sketch/sketch-catalog.js";
import {
  createSketchDocument,
  createSketchLayer,
  type SketchDocument,
  type SketchLayer,
} from "../sketch/document.js";
import {
  createDefaultSketchLister,
  downloadRemoteTiltBytes,
  type SketchLister,
} from "../sketch/icosa-gallery.js";
import { readTiltFile } from "../sketch/tilt-file.js";
import { convertTiltBrushUnitsToMeters } from "../sketch/tilt-brush-units.js";
import type { StrokeData } from "../types.js";
import {
  applyUIKitProperties,
  clearUIKitInteractionStateExcept,
} from "../panels/uikit-interaction.js";
import { AudioFeedbackSystem } from "./audio-feedback-system.js";
import { IntroSketchSystem } from "./intro-sketch-system.js";
import { StrokeAuthoringSystem } from "./stroke-authoring-system.js";
import { assetUrl } from "../app/asset-url.js";

const WELCOME_SKETCH_ID = "welcome-sketch";
const WELCOME_THUMB_URL = assetUrl("/openbrush/intro/thumbnail.png");
const BLANK_THUMB_URL = assetUrl("/openbrush/blank-icon.png");
const CELLS_PER_PAGE = 6;
// How many curated sketches to pull from the default lister for the gallery.
const REMOTE_PAGE_SIZE = 24;
// Square, low-res thumbnails so captures stay cheap in-headset.
const THUMBNAIL_SIZE = 256;
// Staggered stroke reveal/hide like the original's sketch transitions.
const TRANSITION_IN_SECONDS = 0.9;
const TRANSITION_OUT_SECONDS = 0.5;

interface GalleryEntry {
  id: string;
  name: string;
  thumbUrl: string;
  /** Present for remote (Icosa Gallery) sketches: the `.tilt` download URL. */
  tiltUrl?: string;
}

interface TransitionItem {
  entity: Entity;
  at: number;
}

interface Transition {
  kind: "in" | "out";
  items: TransitionItem[];
  elapsed: number;
  duration: number;
  onDone?: () => void;
}

/**
 * The in-session intro state: a fixed (non-rotating) gallery panel at the
 * wand prism pose offering New Sketch and saved sketches (the welcome sketch
 * included), like the original's intro UI. Owns sketch save/load/new with
 * square low-res thumbnails, and the staggered stroke transitions.
 */
export class SketchLibrarySystem extends createSystem({
  appState: { required: [OpenBrushAppState, PersistenceState] },
  strokes: { required: [BrushStroke] },
  canvases: { required: [CanvasLayer] },
  settings: { required: [SettingsState] },
}) {
  private store: SketchCatalogStore = createStore();
  // The default lister: curated Icosa Gallery sketches ordered by "best".
  private lister: SketchLister = createDefaultSketchLister();
  private galleryEntity?: Entity;
  private galleryHand: "left" | "right" = "left";
  private galleryDocument?: UIKitDocument;
  private entries: GalleryEntry[] = [];
  private localEntries: GalleryEntry[] = [];
  private remoteEntries: GalleryEntry[] = [];
  private remoteRequested = false;
  private page = 0;
  private appliedGallery = "";
  private blobUrls: string[] = [];
  private transition?: Transition;
  private busy = false;
  private thumbnailTarget?: WebGLRenderTarget;
  private thumbnailCamera?: PerspectiveCamera;
  private thumbnailPixels?: Uint8Array;
  private thumbnailCanvas?: HTMLCanvasElement;

  init() {
    // The experience opens on the intro state.
    this.queries.appState.subscribe("qualify", (entity) => {
      entity.setValue(OpenBrushAppState, "mode", "intro");
    });
    for (const entity of this.queries.appState.entities) {
      entity.setValue(OpenBrushAppState, "mode", "intro");
    }
    void this.refreshEntries();
  }

  update(delta: number) {
    this.stepTransition(delta);

    const appState = this.getAppState();
    if (!appState) {
      return;
    }
    const introMode =
      String(appState.getValue(OpenBrushAppState, "mode")) === "intro";
    if (this.galleryEntity && this.galleryHand !== this.offHand()) {
      this.disposeGalleryPanel();
    }
    if (introMode && !this.galleryEntity) {
      this.createGalleryPanel();
    }
    if (!introMode && this.galleryEntity) {
      this.disposeGalleryPanel();
    }
    if (this.galleryEntity?.object3D) {
      // The gallery rides the wand; it has no browser-mode placement.
      this.galleryEntity.object3D.visible =
        this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    }
    if (introMode) {
      this.syncGallery();
    }
  }

  /** Tools-panel Save: persists the current strokes with a thumbnail. */
  saveActiveSketch(): void {
    const appState = this.getAppState();
    if (!appState || this.busy) {
      return;
    }
    const strokes = this.collectStrokeData();
    if (strokes.length === 0) {
      appState.setValue(PersistenceState, "status", "nothing-to-save");
      return;
    }
    const now = Date.now();
    let id = String(appState.getValue(PersistenceState, "activeSketchId"));
    if (!id || id === WELCOME_SKETCH_ID) {
      id = `sketch-${now.toString(36)}`;
    }
    let name = String(appState.getValue(PersistenceState, "activeSketchName"));
    if (!name || name === "Untitled Sketch" || name === "Welcome Sketch") {
      name = `Sketch ${this.entries.length}`;
    }
    const document = createSketchDocument({
      metadata: { source: "runtime" },
      layers: this.collectLayers(),
      strokes,
    });
    const thumbnailPng = this.captureThumbnail();
    const record = createSketchCatalogRecord({
      id,
      name,
      document,
      nowMs: now,
      thumbnailPng,
    });
    this.busy = true;
    void this.store
      .save(record)
      .then(async () => {
        appState.setValue(PersistenceState, "activeSketchId", id);
        appState.setValue(PersistenceState, "activeSketchName", name);
        appState.setValue(PersistenceState, "status", "saved");
        appState.setValue(PersistenceState, "error", "");
        appState.setValue(PersistenceState, "lastSavedAtMs", now);
        appState.setValue(
          PersistenceState,
          "lastTiltByteLength",
          record.tiltBytes.byteLength,
        );
        appState.setValue(
          PersistenceState,
          "lastThumbnailByteLength",
          thumbnailPng?.byteLength ?? 0,
        );
        appState.setValue(
          PersistenceState,
          "saveRevision",
          Number(appState.getValue(PersistenceState, "saveRevision")) + 1,
        );
        appState.setValue(PersistenceState, "isDirty", false);
        appState.setValue(OpenBrushAppState, "toolStatus", `saved "${name}"`);
        this.world.getSystem(AudioFeedbackSystem)?.playSound("save");
        await this.refreshEntries();
      })
      .catch((error) => {
        appState.setValue(PersistenceState, "status", "save-failed");
        appState.setValue(PersistenceState, "error", String(error));
      })
      .finally(() => {
        this.busy = false;
      });
  }

  /** All visible finalized strokes — the collab snapshot payload. */
  collectVisibleStrokeData(): StrokeData[] {
    return this.collectStrokeData();
  }

  /**
   * Guest side of a collab join: clear the local sketch immediately (no
   * transition) so the host's streamed snapshot lands on a blank canvas.
   */
  prepareForCollabJoin(): void {
    const appState = this.getAppState();
    if (!appState) {
      return;
    }
    this.transition = undefined;
    this.busy = false;
    this.getIntroSketchSystem()?.setSketchVisible(false, false);
    this.disposeAllStrokes();
    appState.setValue(PersistenceState, "activeSketchId", "");
    appState.setValue(PersistenceState, "activeSketchName", "Shared Sketch");
    appState.setValue(OpenBrushAppState, "mode", "ready");
    appState.setValue(OpenBrushAppState, "toolStatus", "joining");
  }

  /** Adopt the host's sketch name so the guest's Save keeps it. */
  adoptCollabSketchName(name: string): void {
    const appState = this.getAppState();
    if (!appState) {
      return;
    }
    const next = name || "Shared Sketch";
    const current = String(
      appState.getValue(PersistenceState, "activeSketchName"),
    );
    if (current === next) {
      // Reconnect resync: keep the existing catalog id so a later Save
      // updates the guest's record instead of duplicating it.
      return;
    }
    appState.setValue(PersistenceState, "activeSketchName", next);
    appState.setValue(PersistenceState, "activeSketchId", "");
  }

  /** Tools-panel Home: back to the intro state, keeping the sketch visible. */
  quitToIntro(): void {
    const appState = this.getAppState();
    if (!appState || this.busy) {
      return;
    }
    appState.setValue(OpenBrushAppState, "mode", "intro");
    appState.setValue(OpenBrushAppState, "toolStatus", "gallery");
    void this.refreshEntries();
  }

  private startNewSketch(): void {
    const appState = this.getAppState();
    if (!appState || this.busy) {
      return;
    }
    this.busy = true;
    this.transitionOutStrokes(() => {
      this.getIntroSketchSystem()?.setSketchVisible(false);
      appState.setValue(PersistenceState, "activeSketchId", "");
      appState.setValue(PersistenceState, "activeSketchName", "Untitled Sketch");
      appState.setValue(OpenBrushAppState, "mode", "ready");
      appState.setValue(OpenBrushAppState, "toolStatus", "draw-ready");
      this.busy = false;
    });
  }

  private openSketch(entry: GalleryEntry): void {
    const appState = this.getAppState();
    if (!appState || this.busy) {
      return;
    }
    this.busy = true;
    if (entry.id === WELCOME_SKETCH_ID) {
      this.transitionOutStrokes(() => {
        this.getIntroSketchSystem()?.setSketchVisible(true);
        appState.setValue(PersistenceState, "activeSketchId", WELCOME_SKETCH_ID);
        appState.setValue(PersistenceState, "activeSketchName", "Welcome Sketch");
        appState.setValue(OpenBrushAppState, "mode", "ready");
        this.busy = false;
      });
      return;
    }
    if (entry.tiltUrl) {
      // Curated Icosa sketch: download the .tilt and open it as a fresh,
      // unsaved sketch (activeSketchId cleared) so Save creates the user's own
      // local copy rather than trying to overwrite the remote asset.
      appState.setValue(OpenBrushAppState, "toolStatus", `loading "${entry.name}"`);
      void downloadRemoteTiltBytes(entry.tiltUrl)
        .then((bytes) => {
          // Native Tilt Brush files are authored in Tilt Brush units
          // (decimetres); convert to Brushspace metres like Open Brush's canvas
          // does, otherwise the sketch spawns 10x too large and reads as empty.
          const document = convertTiltBrushUnitsToMeters(readTiltFile(bytes));
          this.openDocument(document, "", entry.name);
        })
        .catch((error) => {
          appState.setValue(PersistenceState, "status", "load-failed");
          appState.setValue(PersistenceState, "error", String(error));
          appState.setValue(OpenBrushAppState, "toolStatus", "load failed");
          this.busy = false;
        });
      return;
    }
    void this.store
      .load(entry.id)
      .then((record) => {
        if (!record) {
          this.busy = false;
          return;
        }
        this.openDocument(
          readSketchCatalogRecordDocument(record),
          record.id,
          record.name,
        );
      })
      .catch(() => {
        this.busy = false;
      });
  }

  /**
   * Runs the shared open path: staggered clear of the current strokes, then
   * spawns the document's strokes with the staggered reveal. An empty `id`
   * marks the sketch as unsaved (remote/remixed) so a later Save forks a new
   * local record.
   */
  private openDocument(
    document: SketchDocument,
    id: string,
    name: string,
  ): void {
    const appState = this.getAppState();
    if (!appState) {
      this.busy = false;
      return;
    }
    this.transitionOutStrokes(() => {
      this.getIntroSketchSystem()?.setSketchVisible(false);
      const authoring = this.world.getSystem(StrokeAuthoringSystem);
      const spawned: Entity[] = [];
      for (const strokeData of document.strokes) {
        const entity = authoring?.spawnStrokeFromData(
          strokeData as StrokeData,
          false,
        );
        if (entity) {
          spawned.push(entity);
        }
      }
      appState.setValue(PersistenceState, "activeSketchId", id);
      appState.setValue(PersistenceState, "activeSketchName", name);
      appState.setValue(PersistenceState, "status", "loaded");
      appState.setValue(PersistenceState, "error", "");
      appState.setValue(PersistenceState, "lastLoadedAtMs", Date.now());
      appState.setValue(
        PersistenceState,
        "loadRevision",
        Number(appState.getValue(PersistenceState, "loadRevision")) + 1,
      );
      appState.setValue(OpenBrushAppState, "mode", "ready");
      this.world.getSystem(AudioFeedbackSystem)?.playSound("load-sketch");
      this.transitionInStrokes(spawned, () => {
        this.busy = false;
      });
    });
  }

  // -------------------------------------------------------------------------
  // Gallery panel
  // -------------------------------------------------------------------------

  private createGalleryPanel(): void {
    // The wand prism rides the off-hand grip; the gallery takes its place.
    const hand = this.offHand();
    const grip =
      hand === "left"
        ? this.world.playerSpaceEntities.gripSpaces.left
        : this.world.playerSpaceEntities.gripSpaces.right;
    const entity = this.world
      .createTransformEntity(undefined, grip)
      .addComponent(PanelUI, {
        config: "./ui/intro-gallery.json",
        maxWidth: 0.24,
        maxHeight: 0.31,
      })
      .addComponent(RayInteractable);
    entity.object3D!.name = "OpenBrushIntroGallery";
    // The prism top-face pose (face up like a watch, top edge pointing away
    // from the hand), pushed forward so the larger panel clears the grip.
    // Fixed — no ring rotation.
    entity.object3D!.position.set(0, 0.035, -0.13);
    entity.object3D!.quaternion.set(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
    this.galleryEntity = entity;
    this.galleryHand = hand;
    this.appliedGallery = "";
  }

  private offHand(): "left" | "right" {
    for (const entity of this.queries.settings.entities) {
      const dominant = String(entity.getValue(SettingsState, "dominantHand"));
      return dominant === "left" ? "right" : "left";
    }
    return "left";
  }

  private disposeGalleryPanel(): void {
    // Fully dispose (not just hide): invisible panels still cost layout and
    // stay interactive.
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls = [];
    this.galleryEntity?.dispose();
    this.galleryEntity = undefined;
    this.galleryDocument = undefined;
  }

  private syncGallery(): void {
    const entity = this.galleryEntity;
    if (!entity) {
      return;
    }
    // Entity indices are recycled: until this panel instance actually loads,
    // the PanelDocument slot can still hold a disposed panel's document.
    // Gate on the component and bind by document identity, not a flag.
    if (!entity.hasComponent(PanelDocument)) {
      return;
    }
    const document = PanelDocument.data.document[entity.index] as UIKitDocument;
    if (!document) {
      return;
    }
    if (this.galleryDocument !== document) {
      this.galleryDocument = document;
      this.appliedGallery = "";
      this.bindGallery(document);
    }
    const pageCount = Math.max(1, Math.ceil(this.entries.length / CELLS_PER_PAGE));
    this.page = Math.min(this.page, pageCount - 1);
    const key = `${this.page}:${this.entries.map((entry) => entry.id).join(",")}`;
    if (key === this.appliedGallery) {
      return;
    }
    this.appliedGallery = key;

    const setText = (id: string, text: string) => {
      const element = document.getElementById(id) as {
        setProperties(properties: Record<string, unknown>): void;
      } | null;
      element?.setProperties({ text });
    };
    setText("gallery-page-mark", `${this.page + 1} / ${pageCount}`);
    const start = this.page * CELLS_PER_PAGE;
    for (let cell = 0; cell < CELLS_PER_PAGE; cell += 1) {
      const entry = this.entries[start + cell];
      const button = document.getElementById(`gallery-sketch-${cell}`) as {
        setProperties(properties: Record<string, unknown>): void;
      } | null;
      const thumb = document.getElementById(`gallery-thumb-${cell}`) as {
        setProperties(properties: Record<string, unknown>): void;
      } | null;
      thumb?.setProperties({ src: entry ? entry.thumbUrl : BLANK_THUMB_URL });
      if (button) {
        // Repairs hover/active conditional reactivity: paging restyles can
        // land while a tile is hovered, which would freeze its hover fill.
        applyUIKitProperties(button, {
          borderColor: entry ? "#ffffff" : "rgba(255, 255, 255, 0.15)",
        });
      }
    }
    const savedCount = Math.max(0, this.localEntries.length - 1);
    const curatedCount = this.remoteEntries.length;
    const parts: string[] = [];
    if (savedCount > 0) {
      parts.push(`${savedCount} saved`);
    }
    if (curatedCount > 0) {
      parts.push(`${curatedCount} curated`);
    }
    setText("gallery-label", parts.length > 0 ? parts.join(" · ") : "Welcome Sketch");
  }

  private bindGallery(document: UIKitDocument): void {
    const on = (id: string, handler: () => void) => {
      const element = document.getElementById(id) as {
        addEventListener(type: string, listener: () => void): void;
      } | null;
      element?.addEventListener("click", () => {
        clearUIKitInteractionStateExcept(document, element);
        this.world.getSystem(AudioFeedbackSystem)?.playSound("ui-click");
        handler();
      });
    };
    on("gallery-new", () => this.startNewSketch());
    on("gallery-prev", () => {
      const pageCount = Math.max(1, Math.ceil(this.entries.length / CELLS_PER_PAGE));
      this.page = (this.page - 1 + pageCount) % pageCount;
    });
    on("gallery-next", () => {
      const pageCount = Math.max(1, Math.ceil(this.entries.length / CELLS_PER_PAGE));
      this.page = (this.page + 1) % pageCount;
    });
    for (let cell = 0; cell < CELLS_PER_PAGE; cell += 1) {
      on(`gallery-sketch-${cell}`, () => {
        const entry = this.entries[this.page * CELLS_PER_PAGE + cell];
        if (entry) {
          this.openSketch(entry);
        }
      });
    }
  }

  private async refreshEntries(): Promise<void> {
    const items = await this.store.list();
    items.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    this.getAppState()?.setValue(
      PersistenceState,
      "catalogEntryCount",
      items.length,
    );
    for (const url of this.blobUrls) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls = [];
    const entries: GalleryEntry[] = [
      { id: WELCOME_SKETCH_ID, name: "Welcome Sketch", thumbUrl: WELCOME_THUMB_URL },
    ];
    for (const item of items) {
      entries.push({
        id: item.id,
        name: item.name,
        thumbUrl: await this.thumbUrlFor(item),
      });
    }
    this.localEntries = entries;
    this.rebuildEntries();
    // Curated Icosa sketches load lazily and degrade gracefully; a slow or
    // failed network never blocks the local gallery.
    if (!this.remoteRequested) {
      this.remoteRequested = true;
      void this.refreshRemoteEntries();
    }
  }

  /** Combines local and remote entries into the paged gallery list. */
  private rebuildEntries(): void {
    this.entries = [...this.localEntries, ...this.remoteEntries];
    this.appliedGallery = "";
  }

  /**
   * Pulls the default lister's curated sketches and appends them to the
   * gallery. Remote thumbnails are plain CORS-enabled URLs, so unlike local
   * captures they need no blob bookkeeping. Failures leave the gallery on its
   * local entries.
   */
  private async refreshRemoteEntries(): Promise<void> {
    try {
      const page = await this.lister.listPage();
      this.remoteEntries = page.entries.map((entry) => ({
        id: `icosa:${entry.assetId}`,
        name: entry.name,
        thumbUrl: entry.thumbnailUrl || BLANK_THUMB_URL,
        tiltUrl: entry.tiltUrl,
      }));
      this.rebuildEntries();
    } catch {
      // Offline or blocked: keep the local-only gallery.
      this.remoteEntries = [];
    }
  }

  private async thumbUrlFor(item: SketchCatalogListItem): Promise<string> {
    const record = await this.store.load(item.id);
    if (!record || record.thumbnailPng.byteLength === 0) {
      return BLANK_THUMB_URL;
    }
    const url = URL.createObjectURL(
      new Blob([new Uint8Array(record.thumbnailPng)], { type: "image/png" }),
    );
    this.blobUrls.push(url);
    return url;
  }

  // -------------------------------------------------------------------------
  // Save helpers
  // -------------------------------------------------------------------------

  private collectStrokeData(): StrokeData[] {
    const strokes: Array<{ data: StrokeData; order: number }> = [];
    for (const entity of this.queries.strokes.entities) {
      if (
        !entity.getValue(BrushStroke, "finalized") ||
        !entity.getValue(BrushStroke, "visible")
      ) {
        continue;
      }
      const data = entity.object3D?.userData.openBrushStrokeData as
        | StrokeData
        | undefined;
      if (data) {
        strokes.push({
          data,
          order: Number(entity.getValue(BrushStroke, "commandIndex")),
        });
      }
    }
    strokes.sort((a, b) => a.order - b.order);
    return strokes.map((stroke) => stroke.data);
  }

  private collectLayers(): SketchLayer[] {
    const layers: SketchLayer[] = [];
    for (const entity of this.queries.canvases.entities) {
      if (entity.getValue(CanvasLayer, "selectionCanvas")) {
        continue;
      }
      layers.push(
        createSketchLayer({
          id: Number(entity.getValue(CanvasLayer, "layerIndex")),
          name: String(entity.getValue(CanvasLayer, "layerName")),
          visible: Boolean(entity.getValue(CanvasLayer, "visible")),
          locked: Boolean(entity.getValue(CanvasLayer, "locked")),
        }),
      );
    }
    layers.sort((a, b) => a.id - b.id);
    return layers.length > 0
      ? layers
      : [createSketchLayer({ id: 0, name: "Layer 1" })];
  }

  /** Square, low-res snapshot from the viewer's pose. */
  private captureThumbnail(): Uint8Array | undefined {
    const renderer = this.world.renderer;
    if (!this.thumbnailTarget) {
      this.thumbnailTarget = new WebGLRenderTarget(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
      this.thumbnailCamera = new PerspectiveCamera(70, 1, 0.05, 200);
      this.thumbnailPixels = new Uint8Array(THUMBNAIL_SIZE * THUMBNAIL_SIZE * 4);
    }
    const camera = this.thumbnailCamera!;
    this.player.head.getWorldPosition(camera.position);
    this.player.head.getWorldQuaternion(camera.quaternion);
    camera.updateMatrixWorld(true);

    const xrWasEnabled = renderer.xr.enabled;
    const previousTarget = renderer.getRenderTarget();
    renderer.xr.enabled = false;
    renderer.setRenderTarget(this.thumbnailTarget);
    renderer.render(this.world.scene, camera);
    renderer.setRenderTarget(previousTarget);
    renderer.xr.enabled = xrWasEnabled;
    renderer.readRenderTargetPixels(
      this.thumbnailTarget,
      0,
      0,
      THUMBNAIL_SIZE,
      THUMBNAIL_SIZE,
      this.thumbnailPixels!,
    );

    if (!this.thumbnailCanvas) {
      const canvas = globalThis.document?.createElement("canvas");
      if (!canvas) {
        return undefined;
      }
      canvas.width = THUMBNAIL_SIZE;
      canvas.height = THUMBNAIL_SIZE;
      this.thumbnailCanvas = canvas;
    }
    const context = this.thumbnailCanvas.getContext("2d");
    if (!context) {
      return undefined;
    }
    const image = context.createImageData(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    for (let row = 0; row < THUMBNAIL_SIZE; row += 1) {
      const source = (THUMBNAIL_SIZE - 1 - row) * THUMBNAIL_SIZE * 4;
      image.data.set(
        this.thumbnailPixels!.subarray(source, source + THUMBNAIL_SIZE * 4),
        row * THUMBNAIL_SIZE * 4,
      );
    }
    context.putImageData(image, 0, 0);
    const dataUrl = this.thumbnailCanvas.toDataURL("image/png");
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  // -------------------------------------------------------------------------
  // Transitions
  // -------------------------------------------------------------------------

  private transitionOutStrokes(onDone: () => void): void {
    const entities = [...this.queries.strokes.entities].filter((entity) =>
      Boolean(entity.getValue(BrushStroke, "visible")),
    );
    if (entities.length === 0) {
      this.disposeAllStrokes();
      onDone();
      return;
    }
    entities.sort(
      (a, b) =>
        Number(b.getValue(BrushStroke, "commandIndex")) -
        Number(a.getValue(BrushStroke, "commandIndex")),
    );
    this.transition = {
      kind: "out",
      items: entities.map((entity, index) => ({
        entity,
        at: (index / entities.length) * TRANSITION_OUT_SECONDS,
      })),
      elapsed: 0,
      duration: TRANSITION_OUT_SECONDS,
      onDone: () => {
        this.disposeAllStrokes();
        onDone();
      },
    };
  }

  private transitionInStrokes(entities: Entity[], onDone: () => void): void {
    if (entities.length === 0) {
      onDone();
      return;
    }
    this.transition = {
      kind: "in",
      items: entities.map((entity, index) => ({
        entity,
        at: (index / entities.length) * TRANSITION_IN_SECONDS,
      })),
      elapsed: 0,
      duration: TRANSITION_IN_SECONDS,
      onDone,
    };
  }

  private stepTransition(delta: number): void {
    const transition = this.transition;
    if (!transition) {
      return;
    }
    transition.elapsed += delta;
    const visibleValue = transition.kind === "in";
    for (const item of transition.items) {
      if (item.at <= transition.elapsed) {
        if (
          Boolean(item.entity.getValue(BrushStroke, "visible")) !== visibleValue
        ) {
          item.entity.setValue(BrushStroke, "visible", visibleValue);
        }
      }
    }
    if (transition.elapsed >= transition.duration + 0.05) {
      this.transition = undefined;
      transition.onDone?.();
    }
  }

  private disposeAllStrokes(): void {
    this.world.getSystem(StrokeAuthoringSystem)?.resetStrokeHistory();
    for (const entity of [...this.queries.strokes.entities]) {
      const object = entity.object3D;
      if (object) {
        // Dispose geometry ourselves; materials are shared per brush GUID and
        // must survive.
        object.traverse((child) => {
          const mesh = child as { geometry?: { dispose(): void } };
          mesh.geometry?.dispose();
        });
      }
      entity.destroy();
    }
  }

  private getIntroSketchSystem(): IntroSketchSystem | undefined {
    return this.world.getSystem(IntroSketchSystem);
  }

  private getAppState(): Entity | undefined {
    const next = this.queries.appState.entities.values().next();
    return next.done ? undefined : next.value;
  }
}

function createStore(): SketchCatalogStore {
  try {
    if (typeof indexedDB !== "undefined") {
      return new IndexedDbSketchCatalogStore();
    }
  } catch {
    // Fall through to the in-memory store.
  }
  return new MemorySketchCatalogStore();
}
