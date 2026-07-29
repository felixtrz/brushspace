import { createSketchDocument, createSketchLayer } from "../sketch/document.js";
import { writeTiltFile } from "../sketch/tilt-file.js";
import type { StrokeData } from "../types.js";
import { createBrushConformanceFixtures } from "./brush-conformance-fixtures.js";

/**
 * Writes the shared deterministic corpus as a standard .tilt payload that
 * can be opened by the pinned Open Brush build. Every stroke is rebound to
 * the requested brush GUID while retaining its seed and control-point data.
 */
export function writeBrushConformanceTilt(brushGuid: string): Uint8Array {
  const strokes = createBrushConformanceFixtures().flatMap((fixture) =>
    fixture.strokes.map((stroke) => cloneStrokeForBrush(stroke, brushGuid)),
  );
  return writeTiltFile(
    createSketchDocument({
      metadata: {
        appName: "Brushspace Conformance Corpus",
        source: "fixture",
      },
      layers: [createSketchLayer({ id: 0, name: "Conformance" })],
      strokes,
    }),
  );
}

function cloneStrokeForBrush(stroke: StrokeData, brushGuid: string): StrokeData {
  return {
    ...stroke,
    brushGuid,
    color: [...stroke.color],
    controlPoints: stroke.controlPoints.map((point) => ({
      ...point,
      position: [...point.position],
      orientation: [...point.orientation],
    })),
  };
}
