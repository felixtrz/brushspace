import { describe, expect, it } from "vitest";

import {
  UNITS_TO_METERS,
  convertTiltBrushUnitsToMeters,
} from "./tilt-brush-units.js";
import { createSketchDocument } from "./document.js";
import { createEmptyStrokeData } from "../types.js";

describe("convertTiltBrushUnitsToMeters", () => {
  it("matches Open Brush App.UNITS_TO_METERS (1 unit = 1 decimetre)", () => {
    expect(UNITS_TO_METERS).toBe(0.1);
  });

  it("scales positions and brush size by the unit conversion", () => {
    const doc = createSketchDocument({
      strokes: [
        createEmptyStrokeData({
          brushSize: 2,
          controlPoints: [
            {
              position: [10, -20, 30],
              orientation: [0, 0, 0, 1],
              pressure: 1,
              timestampMs: 0,
            },
          ],
        }),
      ],
    });
    const meters = convertTiltBrushUnitsToMeters(doc);
    expect(meters.strokes[0].controlPoints[0].position).toEqual([1, -2, 3]);
    expect(meters.strokes[0].brushSize).toBeCloseTo(0.2, 10);
  });

  it("preserves orientation, pressure, color, and metadata", () => {
    const doc = createSketchDocument({
      metadata: { source: "tilt" },
      strokes: [
        createEmptyStrokeData({
          color: [0.2, 0.4, 0.6, 1],
          controlPoints: [
            {
              position: [5, 5, 5],
              orientation: [0.1, 0.2, 0.3, 0.9],
              pressure: 0.75,
              timestampMs: 42,
            },
          ],
        }),
      ],
    });
    const meters = convertTiltBrushUnitsToMeters(doc);
    const cp = meters.strokes[0].controlPoints[0];
    expect(cp.orientation).toEqual([0.1, 0.2, 0.3, 0.9]);
    expect(cp.pressure).toBe(0.75);
    expect(meters.strokes[0].color).toEqual([0.2, 0.4, 0.6, 1]);
    expect(meters.metadata.source).toBe("tilt");
  });

  it("accepts an explicit scale override", () => {
    const doc = createSketchDocument({
      strokes: [
        createEmptyStrokeData({
          brushSize: 1,
          controlPoints: [
            {
              position: [2, 2, 2],
              orientation: [0, 0, 0, 1],
              pressure: 1,
              timestampMs: 0,
            },
          ],
        }),
      ],
    });
    const scaled = convertTiltBrushUnitsToMeters(doc, 0.5);
    expect(scaled.strokes[0].controlPoints[0].position).toEqual([1, 1, 1]);
    expect(scaled.strokes[0].brushSize).toBe(0.5);
  });
});
