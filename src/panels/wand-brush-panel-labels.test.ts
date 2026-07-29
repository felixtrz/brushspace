import { describe, expect, it } from "vitest";

import {
  OPEN_BRUSH_DEFAULT_BRUSH_GUID,
  selectableOpenBrushes,
} from "../brushes/brush-catalog.js";
import {
  resolveWandBrushPanelLabels,
  resolveWandBrushPanelToolStatusMeta,
} from "./wand-brush-panel-labels.js";

describe("Phase A wand brush panel labels", () => {
  it("labels paint sizing as brush size controls", () => {
    const labels = resolveWandBrushPanelLabels(baseInput());

    expect(labels.activeBrushName).toBe(lightBrush.name);
    expect(labels.activeBrushMeta).toContain(
      `${lightBrush.geometryFamily} / ${lightBrush.materialFamily}`,
    );
    expect(labels.wandBrushName).toBe(lightBrush.name);
    expect(labels.wandBrushMeta).toBe(
      `${lightBrush.geometryFamily} / ${lightBrushIndex + 1}/${selectableOpenBrushes.length}`,
    );
    expect(labels.wandBrushSize).toBe("Size 50% | 1.1 cm");
    expect(labels.sizeDown).toBe("Size -");
    expect(labels.sizeUp).toBe("Size +");
    expect(labels.warning).toBe("Renderer eligible; visual fidelity unvalidated");
  });

  it("labels eraser sizing as radius controls", () => {
    const labels = resolveWandBrushPanelLabels(
      baseInput({
        eraserActive: true,
        eraserRadius: 0.02,
      }),
    );

    expect(labels.wandBrushName).toBe("Eraser");
    expect(labels.wandBrushMeta).toBe("contact radius");
    expect(labels.wandBrushSize).toBe("Radius 50% | 2.0 cm");
    expect(labels.sizeDown).toBe("Radius -");
    expect(labels.sizeUp).toBe("Radius +");
    expect(labels.activeBrushMeta).toContain("radius 50% | 2.0 cm");
  });

  it("tracks adjusted eraser radius percentages after hand-panel size changes", () => {
    const labels = resolveWandBrushPanelLabels(
      baseInput({
        eraserActive: true,
        eraserRadius: 0.021,
      }),
    );

    expect(labels.wandBrushSize).toBe("Radius 55% | 2.1 cm");
    expect(labels.activeBrushMeta).toContain("radius 55% | 2.1 cm");
  });

  it("keeps panel-focus wording visible for paint and eraser modes", () => {
    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          panelFocusBlocked: true,
        }),
      ).wandBrushMeta,
    ).toBe(`${lightBrush.geometryFamily} / panel focus`);
    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          eraserActive: true,
          panelFocusBlocked: true,
        }),
      ).wandBrushMeta,
    ).toBe("panel focus");
  });

  it("surfaces eraser miss and hit results in the hand panel", () => {
    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          eraserActive: true,
          toolStatus: "nothing-to-erase",
        }),
      ).wandBrushMeta,
    ).toBe("miss: no stroke");

    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          eraserActive: true,
          toolStatus: "erased 2 strokes",
        }),
      ).wandBrushMeta,
    ).toBe("hit: erased 2 strokes");
  });

  it("surfaces picker/dropper pending, miss, and hit results", () => {
    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          toolStatus: "picker-pending",
        }),
      ).wandBrushMeta,
    ).toBe(`${lightBrush.geometryFamily} / aim picker at stroke`);

    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          toolStatus: "dropper-pending",
        }),
      ).wandBrushMeta,
    ).toBe(`${lightBrush.geometryFamily} / aim dropper at stroke`);

    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          toolStatus: "nothing-to-pick",
        }),
      ).wandBrushMeta,
    ).toBe(`${lightBrush.geometryFamily} / miss: no target`);

    expect(
      resolveWandBrushPanelLabels(
        baseInput({
          toolStatus: "picked brush #3",
        }),
      ).wandBrushMeta,
    ).toBe(`${lightBrush.geometryFamily} / picked brush #3`);
  });

  it("formats only known temporary tool statuses for the compact panel", () => {
    expect(resolveWandBrushPanelToolStatusMeta("nothing-to-erase")).toBe(
      "miss: no stroke",
    );
    expect(resolveWandBrushPanelToolStatusMeta("erased 1 stroke")).toBe(
      "hit: erased 1 stroke",
    );
    expect(resolveWandBrushPanelToolStatusMeta("picked color #1")).toBe(
      "picked color #1",
    );
    expect(resolveWandBrushPanelToolStatusMeta("draw-ready")).toBeUndefined();
  });

  it("falls back without leaking invalid size text", () => {
    const labels = resolveWandBrushPanelLabels(
      baseInput({
        brushSize01: Number.NaN,
        brushSize: undefined,
      }),
    );

    expect(labels.wandBrushSize).toBe("Size 50% | 1.1 cm");
    expect(labels.wandBrushSize).not.toContain("NaN");
  });
});

const lightBrush = getLightBrush();
const lightBrushIndex = lightBrush ? selectableOpenBrushes.indexOf(lightBrush) : 0;

function baseInput(
  overrides: Partial<Parameters<typeof resolveWandBrushPanelLabels>[0]> = {},
): Parameters<typeof resolveWandBrushPanelLabels>[0] {
  return {
    activeBrush: lightBrush,
    activeBrushIndex: lightBrushIndex,
    brushCount: selectableOpenBrushes.length,
    brushSize01: 0.5,
    brushSize: 0.01125,
    eraserRadius: 0.02,
    eraserActive: false,
    panelFocusBlocked: false,
    toolStatus: "draw-ready",
    ...overrides,
  };
}

function getLightBrush() {
  const brush = selectableOpenBrushes.find(
    (entry) => entry.guid === OPEN_BRUSH_DEFAULT_BRUSH_GUID,
  );
  if (!brush) {
    throw new Error("Expected the upstream Light brush to be selectable.");
  }
  return brush;
}
