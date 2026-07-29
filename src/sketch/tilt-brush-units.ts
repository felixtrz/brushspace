/**
 * Tilt Brush unit conversion.
 *
 * Open Brush / Tilt Brush author sketches in "Tilt Brush units", where one
 * unit is a decimetre — see App.cs: `METERS_TO_UNITS = 10`,
 * `UNITS_TO_METERS = 0.1`. Their engine keeps the whole scene (and the tracked
 * room) in those units, so it reads 1:1 to the artist. Brushspace instead
 * works in metres (WebXR tracking is metric), which is why the intro sketch
 * and baked geometry apply a 0.1 scale on the way in.
 *
 * Sketches painted inside Brushspace are already captured in metres, but a
 * `.tilt` imported from Tilt Brush / Icosa Gallery arrives in decimetres and
 * must be converted the same way Open Brush's canvas would — a uniform scale
 * of both control-point positions and brush sizes, which leaves orientations
 * and proportions intact. Without it an imported sketch spawns ten times too
 * large and reads as an empty scene.
 */

import { createSketchDocument, type SketchDocument } from "./document.js";
import type { ControlPoint, StrokeData } from "../types.js";

/** Open Brush `App.UNITS_TO_METERS`: one Tilt Brush unit is a decimetre. */
export const UNITS_TO_METERS = 0.1;

/**
 * Converts a sketch authored in Tilt Brush units (decimetres) into Brushspace
 * metres by uniformly scaling positions and brush sizes.
 */
export function convertTiltBrushUnitsToMeters(
  document: SketchDocument,
  scale: number = UNITS_TO_METERS,
): SketchDocument {
  const strokes = document.strokes.map<StrokeData>((stroke) => ({
    ...stroke,
    brushSize: stroke.brushSize * scale,
    controlPoints: stroke.controlPoints.map<ControlPoint>((point) => ({
      ...point,
      position: [
        point.position[0] * scale,
        point.position[1] * scale,
        point.position[2] * scale,
      ],
    })),
  }));

  return createSketchDocument({
    metadata: document.metadata,
    layers: document.layers,
    media: document.media,
    strokes,
  });
}
