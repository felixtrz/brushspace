import { describe, expect, it } from "vitest";
import {
  generateBrushGeometry,
  getGeneratedIndexCount,
  getGeneratedVertexCount,
  type StrokeData,
} from "three-tiltloader";

describe("three-tiltloader geometry integration", () => {
  it("loads the pinned package and generates ribbon geometry", () => {
    const stroke: StrokeData = {
      guid: "three-tiltloader-ribbon",
      brushGuid: "2241cd32-8ba2-48a5-9ee7-2caef7e9ed62",
      brushSize: 0.2,
      brushScale: 1,
      color: [1, 1, 1, 1],
      layerIndex: 0,
      flags: 0,
      seed: 1,
      groupId: 1,
      controlPoints: [
        {
          position: [0, 0, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 0,
        },
        {
          position: [1, 0, 0],
          orientation: [0, 0, 0, 1],
          pressure: 1,
          timestampMs: 16,
        },
      ],
    };

    const geometry = generateBrushGeometry(stroke, "ribbon");

    expect(getGeneratedVertexCount(geometry)).toBe(4);
    expect(getGeneratedIndexCount(geometry)).toBe(6);
    expect(geometry.positions).toBeInstanceOf(Float32Array);
    expect(geometry.indices).toBeInstanceOf(Uint32Array);
  });
});
