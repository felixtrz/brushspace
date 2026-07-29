import { describe, expect, it } from "vitest";

import { listTiltFileEntries, readTiltFile } from "../sketch/tilt-file.js";
import { StrokeFlags } from "../types.js";
import { writeBrushConformanceTilt } from "./brush-conformance-tilt.js";

const TARGET_BRUSH_GUID = "f72ec0e7-a844-4e38-82e3-140c44772699";

describe("Open Brush conformance .tilt corpus", () => {
  it("round-trips the shared fixtures through the standard file codec", () => {
    const bytes = writeBrushConformanceTilt(TARGET_BRUSH_GUID);
    expect(listTiltFileEntries(bytes)).toEqual([
      "data.sketch",
      "metadata.json",
      "thumbnail.png",
    ]);

    const document = readTiltFile(bytes);
    expect(document.metadata.appName).toBe("Brushspace Conformance Corpus");
    expect(document.strokes).toHaveLength(11);
    expect(
      document.strokes.every((stroke) => stroke.brushGuid === TARGET_BRUSH_GUID),
    ).toBe(true);
    expect(document.strokes.map(({ controlPoints }) => controlPoints.length)).toEqual([
      17,
      25,
      49,
      5,
      5,
      17,
      17,
      1,
      257,
      9,
      9,
    ]);
  });

  it("preserves pressure, twist, seed, and explicit break grouping", () => {
    const strokes = readTiltFile(
      writeBrushConformanceTilt(TARGET_BRUSH_GUID),
    ).strokes;
    const pressure = strokes[5];
    expect(pressure.controlPoints[0].pressure).toBe(0);
    expect(pressure.controlPoints[pressure.controlPoints.length - 1].pressure).toBe(
      1,
    );
    const twist = strokes[6];
    expect(
      twist.controlPoints[twist.controlPoints.length - 1].orientation[3],
    ).toBeCloseTo(-1);
    expect(strokes.every(({ seed }) => seed === 0x5eed)).toBe(true);

    const breakStrokes = strokes.filter(({ groupId }) => groupId === 7);
    expect(breakStrokes).toHaveLength(2);
    expect(breakStrokes[0].flags).toBe(StrokeFlags.None);
    expect(breakStrokes[1].flags).toBe(StrokeFlags.IsGroupContinue);
  });
});
