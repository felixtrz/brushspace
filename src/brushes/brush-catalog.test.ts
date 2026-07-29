import { describe, expect, it } from "vitest";

import {
  OPEN_BRUSH_DEFAULT_SIZE01,
  brushSize01ToLiveBrushSize,
} from "./brush-size.js";
import {
  OPEN_BRUSH_DEFAULT_BRUSH_GUID,
  initialOpenBrushIndex,
  selectableOpenBrushes,
  setExperimentalBrushesEnabled,
  visibleOpenBrushes,
} from "./brush-catalog.js";

describe("Open Brush brush catalog", () => {
  it("keeps the full catalog visible while enabling only likely-mostly-correct brushes", () => {
    setExperimentalBrushesEnabled(false);
    expect(visibleOpenBrushes).toHaveLength(48);
    expect(selectableOpenBrushes).toHaveLength(48);
    setExperimentalBrushesEnabled(true);
    expect(visibleOpenBrushes).toHaveLength(95);
    expect(selectableOpenBrushes).toHaveLength(95);
    expect(
      visibleOpenBrushes
        .slice(48, 60)
        .every((entry) => entry.catalogSection === "experimental"),
    ).toBe(true);
    expect(selectableOpenBrushes.every((entry) => entry.pickerEnabled)).toBe(true);
    setExperimentalBrushesEnabled(false);
  });

  it("starts on the upstream Light brush instead of the Marker fixture", () => {
    const defaultBrush = selectableOpenBrushes[initialOpenBrushIndex];

    expect(OPEN_BRUSH_DEFAULT_BRUSH_GUID).toBe(
      "2241cd32-8ba2-48a5-9ee7-2caef7e9ed62",
    );
    expect(defaultBrush).toMatchObject({
      guid: OPEN_BRUSH_DEFAULT_BRUSH_GUID,
      name: "Light",
      brushSizeRange: [0.05, 0.2],
      pressureOpacityRange: [0.5, 1],
    });
    expect(
      brushSize01ToLiveBrushSize(
        OPEN_BRUSH_DEFAULT_SIZE01,
        defaultBrush.brushSizeRange,
      ),
    ).toBeCloseTo(0.01125, 6);
  });
});
