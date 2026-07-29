import {
  PanelDocument,
  PanelUI,
  UIKitDocument,
  createSystem,
} from "@iwsdk/core";
import type { Entity } from "@iwsdk/core";

import {
  BrushSettings,
  OpenBrushBrushPage,
  OpenBrushPanelAttachment,
} from "../components/core.js";
import {
  OPEN_BRUSH_DEFAULT_BRUSH_GUID,
  openBrushInventory,
  selectableOpenBrushes,
  setExperimentalBrushesEnabled,
  visibleOpenBrushes,
} from "../brushes/brush-catalog.js";
import {
  applyUIKitProperties,
  clearUIKitInteractionStateExcept,
} from "../panels/uikit-interaction.js";
import {
  findBrushByGuid,
  type BrushInventoryEntry,
} from "../brushes/brush-inventory.js";
import { assetUrl } from "../app/asset-url.js";

const GRID_COLUMNS = 4;
const GRID_ROWS = 3;
const CELLS_PER_PAGE = GRID_COLUMNS * GRID_ROWS;
const BLANK_ICON_SRC = assetUrl("/openbrush/blank-icon.png");
// Matches the .brush-cell styles in ui/wand-brush.uikitml; the selected cell
// keeps the shared white outline and signals selection with a brighter fill.
const CELL_BORDER_DEFAULT = "#ffffff";
const CELL_BORDER_SELECTED = "#ffffff";
const CELL_BORDER_EMPTY = "rgba(0, 0, 0, 0)";
const CELL_BACKGROUND_DEFAULT = "rgba(0, 0, 0, 0.02)";
const CELL_BACKGROUND_SELECTED = "rgba(255, 255, 255, 0.28)";
const CELL_BORDER_UNVERIFIED = "rgba(255, 170, 70, 0.8)";
const CELL_BACKGROUND_UNVERIFIED = "rgba(255, 130, 30, 0.08)";

interface UIKitStyleElement {
  setProperties(properties: Record<string, unknown>): void;
  addEventListener(type: string, listener: () => void): void;
}

/**
 * Drives the paginated brush selection page (ui/wand-brush.uikitml): a 4x4
 * 4x3 grid of brush icons with prev/next paging, mirroring Open Brush's brush
 * panel. Unlike the color picker, this panel is a regular UIKit panel.
 */
export class BrushPageSystem extends createSystem({
  pages: {
    required: [PanelUI, PanelDocument, OpenBrushBrushPage, OpenBrushPanelAttachment],
  },
  brushSettings: { required: [BrushSettings] },
}) {
  private page = 0;
  private experimentalEnabled = false;
  private boundPanelIndex = -1;
  private readonly cellEntries: Array<BrushInventoryEntry | undefined> =
    new Array(CELLS_PER_PAGE).fill(undefined);
  private appliedPage = -1;
  private appliedSelectionGuid = "";
  private appliedSelectionPage = -1;
  private appliedNameGuid = "";
  private appliedMarkPage = -1;

  private get pageCount(): number {
    return Math.max(1, Math.ceil(visibleOpenBrushes.length / CELLS_PER_PAGE));
  }

  update() {
    const pageEntity = this.getFirstEntity("pages");
    const settingsEntity = this.getFirstEntity("brushSettings");
    if (!pageEntity || !settingsEntity) {
      return;
    }
    const document = PanelDocument.data.document[
      pageEntity.index
    ] as UIKitDocument;
    if (!document) {
      return;
    }

    if (this.boundPanelIndex !== pageEntity.index) {
      this.boundPanelIndex = pageEntity.index;
      this.bindDocument(document, settingsEntity);
    }
    if (this.appliedPage !== this.page) {
      this.applyPage(document);
    }
    this.syncSelection(document, settingsEntity);
    this.syncLabels(document, settingsEntity);

    if (Number(pageEntity.getValue(OpenBrushBrushPage, "page")) !== this.page) {
      pageEntity.setValue(OpenBrushBrushPage, "page", this.page);
    }
    if (
      Number(pageEntity.getValue(OpenBrushBrushPage, "pageCount")) !==
      this.pageCount
    ) {
      pageEntity.setValue(OpenBrushBrushPage, "pageCount", this.pageCount);
    }
  }

  private bindDocument(document: UIKitDocument, settingsEntity: Entity): void {
    for (let index = 0; index < CELLS_PER_PAGE; index += 1) {
      const cell = document.getElementById(
        `brush-cell-${index}`,
      ) as UIKitStyleElement | null;
      cell?.addEventListener("click", () => {
        clearUIKitInteractionStateExcept(document, cell);
        const entry = this.cellEntries[index];
        if (entry?.pickerEnabled) {
          settingsEntity.setValue(BrushSettings, "brushGuid", entry.guid);
        }
      });
    }
    const previousButton = document.getElementById(
      "brush-page-prev",
    ) as UIKitStyleElement | null;
    previousButton?.addEventListener("click", () => {
      clearUIKitInteractionStateExcept(document, previousButton);
      this.page = (this.page - 1 + this.pageCount) % this.pageCount;
    });
    const nextButton = document.getElementById(
      "brush-page-next",
    ) as UIKitStyleElement | null;
    nextButton?.addEventListener("click", () => {
      clearUIKitInteractionStateExcept(document, nextButton);
      this.page = (this.page + 1) % this.pageCount;
    });
    const experimentalButton = document.getElementById(
      "brush-experimental-toggle",
    ) as UIKitStyleElement | null;
    experimentalButton?.addEventListener("click", () => {
      clearUIKitInteractionStateExcept(document, experimentalButton);
      this.experimentalEnabled = !this.experimentalEnabled;
      setExperimentalBrushesEnabled(this.experimentalEnabled);
      this.page = 0;
      const activeGuid = String(settingsEntity.getValue(BrushSettings, "brushGuid"));
      if (!selectableOpenBrushes.some((entry) => entry.guid === activeGuid)) {
        settingsEntity.setValue(
          BrushSettings,
          "brushGuid",
          OPEN_BRUSH_DEFAULT_BRUSH_GUID,
        );
      }
      experimentalButton.setProperties({
        text: this.experimentalEnabled
          ? "Experimental: On"
          : "Experimental: Off",
      });
      this.applyPage(document);
    });
    this.applyPage(document);
  }

  private applyPage(document: UIKitDocument): void {
    this.appliedPage = this.page;
    // Force the selection pass to restyle the new page's cells.
    this.appliedSelectionPage = -1;
    const start = this.page * CELLS_PER_PAGE;
    for (let index = 0; index < CELLS_PER_PAGE; index += 1) {
      const entry = visibleOpenBrushes[start + index];
      this.cellEntries[index] = entry;
      const icon = document.getElementById(
        `brush-icon-${index}`,
      ) as UIKitStyleElement | null;
      icon?.setProperties({
        src: entry?.buttonIconFile
          ? assetUrl(`/openbrush/icons/${entry.buttonIconFile}`)
          : BLANK_ICON_SRC,
        opacity: entry?.pickerEnabled ? 1 : 0.3,
      });
    }
  }

  private syncSelection(document: UIKitDocument, settingsEntity: Entity): void {
    const activeGuid = String(settingsEntity.getValue(BrushSettings, "brushGuid"));
    if (
      activeGuid === this.appliedSelectionGuid &&
      this.page === this.appliedSelectionPage
    ) {
      return;
    }
    this.appliedSelectionGuid = activeGuid;
    this.appliedSelectionPage = this.page;
    for (let index = 0; index < CELLS_PER_PAGE; index += 1) {
      const entry = this.cellEntries[index];
      const cell = document.getElementById(
        `brush-cell-${index}`,
      ) as UIKitStyleElement | null;
      if (!cell) {
        continue;
      }
      if (!entry) {
        applyUIKitProperties(cell, {
          borderColor: CELL_BORDER_EMPTY,
          backgroundColor: CELL_BORDER_EMPTY,
        });
        continue;
      }
      const selected = entry.guid === activeGuid;
      const enabled = entry.pickerEnabled;
      // Click restyles land while the cell is still hovered; the helper
      // repairs the conditional reactivity that a plain setProperties would
      // orphan (the stuck grey tile bug).
      applyUIKitProperties(cell, {
        borderColor: selected
          ? CELL_BORDER_SELECTED
          : enabled
            ? CELL_BORDER_DEFAULT
            : CELL_BORDER_UNVERIFIED,
        backgroundColor: selected
          ? CELL_BACKGROUND_SELECTED
          : enabled
            ? CELL_BACKGROUND_DEFAULT
            : CELL_BACKGROUND_UNVERIFIED,
      });
    }
  }

  private syncLabels(document: UIKitDocument, settingsEntity: Entity): void {
    const activeGuid = String(settingsEntity.getValue(BrushSettings, "brushGuid"));
    if (activeGuid !== this.appliedNameGuid) {
      this.appliedNameGuid = activeGuid;
      const activeEntry = findBrushByGuid(openBrushInventory, activeGuid);
      const nameElement = document.getElementById(
        "brush-active-name",
      ) as UIKitStyleElement | null;
      nameElement?.setProperties({ text: activeEntry?.name ?? "" });
      const confidenceElement = document.getElementById(
        "brush-active-confidence",
      ) as UIKitStyleElement | null;
      confidenceElement?.setProperties({
        text:
          activeEntry?.fidelityConfidence === "likely-mostly-correct"
            ? "Likely mostly correct"
            : "Unverified or likely substantially wrong",
      });
    }
    if (this.page !== this.appliedMarkPage) {
      this.appliedMarkPage = this.page;
      const pageMarkElement = document.getElementById(
        "brush-page-mark",
      ) as UIKitStyleElement | null;
      pageMarkElement?.setProperties({
        text: `${this.page + 1} / ${this.pageCount}`,
      });
    }
  }

  private getFirstEntity(
    queryName: "pages" | "brushSettings",
  ): Entity | undefined {
    const next = this.queries[queryName].entities.values().next();
    return next.done ? undefined : next.value;
  }
}
