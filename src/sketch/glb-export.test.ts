import { describe, expect, it } from "vitest";

import { createSketchDocument, createSketchLayer } from "./document.js";
import { createPhase1FixtureDocument, PHASE1_FIXTURE_BRUSH_GUID } from "./fixtures.js";
import { exportSketchDocumentToGlb } from "./glb-export.js";
import { createReferenceMediaAsset, toMediaReference } from "./media-assets.js";
import { createEmptyStrokeData } from "../types.js";

const LIGHT_BRUSH_GUID = "2241cd32-8ba2-48a5-9ee7-2caef7e9ed62";
const MYLAR_TUBE_GUID = "8e58ceea-7830-49b4-aba9-6215104ab52a";

describe("Open Brush GLB export", () => {
  it("exports a valid binary GLB with stroke geometry and metadata extras", () => {
    const result = exportSketchDocumentToGlb(createPhase1FixtureDocument());
    const parsed = parseGlb(result.bytes);

    expect(result.mimeType).toBe("model/gltf-binary");
    expect(result.fileName).toBe("open-brush-sketch.glb");
    expect(parsed.version).toBe(2);
    expect(parsed.totalLength).toBe(result.bytes.byteLength);
    expect(result.summary).toMatchObject({
      meshCount: 1,
      materialCount: 1,
      skippedStrokeCount: 0,
    });
    expect(result.summary.triangleCount).toBeGreaterThan(0);
    expect(parsed.json.asset).toMatchObject({
      version: "2.0",
      generator: "Brushspace",
    });
    expect(parsed.json.scenes[0].extras).toMatchObject({
      TB_Application: "Brushspace",
      TB_Source: "fixture",
      openBrushLayerCount: 2,
      openBrushStrokeCount: 1,
      openBrushExportedStrokeCount: 1,
    });
    expect(parsed.json.buffers[0].byteLength).toBe(parsed.binLength);
    expect(parsed.json.meshes).toHaveLength(1);
    expect(parsed.json.materials).toHaveLength(1);

    const primitive = parsed.json.meshes[0].primitives[0];
    expect(primitive.mode).toBe(4);
    expect(primitive.attributes).toEqual({
      POSITION: expect.any(Number),
      NORMAL: expect.any(Number),
      TANGENT: expect.any(Number),
      COLOR_0: expect.any(Number),
      TEXCOORD_0: expect.any(Number),
    });
    const tangentAccessor = parsed.json.accessors[primitive.attributes.TANGENT];
    expect(tangentAccessor).toMatchObject({
      type: "VEC4",
      count: parsed.json.accessors[primitive.attributes.POSITION].count,
    });
    expect(primitive.extras).toMatchObject({
      openBrushBrushGuid: PHASE1_FIXTURE_BRUSH_GUID,
      openBrushLayerIndex: 0,
    });
    expect(parsed.json.meshes[0].extras).toMatchObject({
      openBrushBrushGuid: PHASE1_FIXTURE_BRUSH_GUID,
      openBrushBrushName: "Marker",
      openBrushControlPointCount: 3,
      openBrushSeed: 42,
      openBrushGroupId: 0,
    });
    expect(parsed.json.materials[0].extras).toMatchObject({
      openBrushBrushGuid: PHASE1_FIXTURE_BRUSH_GUID,
      openBrushBrushName: "Marker",
    });
  });

  it("exports pressure-opacity adjusted vertex colors", () => {
    const result = exportSketchDocumentToGlb(
      createSketchDocument({
        metadata: { source: "runtime" },
        layers: [createSketchLayer({ id: 0, name: "Sketch" })],
        strokes: [
          createEmptyStrokeData({
            guid: "half-pressure-light",
            brushGuid: LIGHT_BRUSH_GUID,
            brushSize: 0.2,
            color: [1, 1, 1, 1],
            layerIndex: 0,
            controlPoints: [
              {
                position: [0, 1, -1],
                orientation: [0, 0, 0, 1],
                pressure: 0.5,
                timestampMs: 0,
              },
              {
                position: [0.2, 1, -1],
                orientation: [0, 0, 0, 1],
                pressure: 0.5,
                timestampMs: 16,
              },
            ],
          }),
        ],
      }),
    );
    const parsed = parseGlb(result.bytes);
    const colorAccessorIndex = parsed.json.meshes[0].primitives[0].attributes.COLOR_0;
    const colorAccessor = parsed.json.accessors[colorAccessorIndex];
    const bufferView = parsed.json.bufferViews[colorAccessor.bufferView];
    const colorOffset = bufferView.byteOffset + (colorAccessor.byteOffset ?? 0);
    const view = new DataView(
      parsed.binBytes.buffer,
      parsed.binBytes.byteOffset,
      parsed.binBytes.byteLength,
    );

    expect(colorAccessor.type).toBe("VEC4");
    expect(view.getFloat32(colorOffset + 3 * 4, true)).toBeCloseTo(0.75);
  });

  it("preserves packed TubeBrush UV0.z as a custom GLB attribute", () => {
    const result = exportSketchDocumentToGlb(
      createSketchDocument({
        metadata: { source: "runtime" },
        layers: [createSketchLayer({ id: 0, name: "Sketch" })],
        strokes: [
          createEmptyStrokeData({
            guid: "radius-packed-tube",
            brushGuid: MYLAR_TUBE_GUID,
            brushSize: 0.2,
            color: [1, 1, 1, 1],
            layerIndex: 0,
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
          }),
        ],
      }),
    );
    const parsed = parseGlb(result.bytes);
    const attributes = parsed.json.meshes[0].primitives[0].attributes;
    const standardUv = parsed.json.accessors[attributes.TEXCOORD_0];
    const packedUv = parsed.json.accessors[attributes._TB_TEXCOORD_0];
    const bufferView = parsed.json.bufferViews[packedUv.bufferView];
    const offset = bufferView.byteOffset + (packedUv.byteOffset ?? 0);
    const view = new DataView(
      parsed.binBytes.buffer,
      parsed.binBytes.byteOffset,
      parsed.binBytes.byteLength,
    );

    expect(standardUv.type).toBe("VEC2");
    expect(packedUv.type).toBe("VEC3");
    expect(packedUv.count).toBe(standardUv.count);
    expect(view.getFloat32(offset + 2 * 4, true)).toBeCloseTo(0.1);
  });

  it("keeps layer roots and buffer views internally consistent", () => {
    const result = exportSketchDocumentToGlb(createPhase1FixtureDocument());
    const parsed = parseGlb(result.bytes);
    const layerNodes = parsed.json.scenes[0].nodes.map(
      (nodeIndex: number) => parsed.json.nodes[nodeIndex],
    );

    expect(layerNodes.map((node: { name: string }) => node.name)).toEqual([
      "Layer 0: Sketch",
      "Layer 1: Reference",
    ]);
    expect(layerNodes[0].children).toHaveLength(1);
    expect(layerNodes[1].children).toHaveLength(0);
    for (const bufferView of parsed.json.bufferViews) {
      expect(bufferView.buffer).toBe(0);
      expect(bufferView.byteOffset + bufferView.byteLength).toBeLessThanOrEqual(
        parsed.binLength,
      );
      expect(bufferView.byteOffset % 4).toBe(0);
    }
  });

  it("reports recoverable warnings for strokes that cannot be exported", () => {
    const document = createSketchDocument({
      metadata: { source: "runtime" },
      layers: [createSketchLayer({ id: 0, name: "Sketch" })],
      strokes: [
        createEmptyStrokeData({
          guid: "missing-layer-stroke",
          brushGuid: PHASE1_FIXTURE_BRUSH_GUID,
          layerIndex: 7,
          controlPoints: [
            {
              position: [0, 1, -1],
              orientation: [0, 0, 0, 1],
              pressure: 1,
              timestampMs: 0,
            },
          ],
        }),
      ],
    });

    const result = exportSketchDocumentToGlb(document);
    expect(result.summary).toMatchObject({
      meshCount: 0,
      skippedStrokeCount: 1,
    });
    expect(result.summary.warnings[0]).toContain("missing layer 7");
    expect(parseGlb(result.bytes).json.meshes).toHaveLength(0);
  });

  it("exports media references as transformable metadata nodes", () => {
    const media = createReferenceMediaAsset({
      id: "ref-image",
      kind: "image",
      fileName: "reference.png",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
      transform: {
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
        scale: [0.5, 0.5, 0.5],
      },
    });
    const document = createSketchDocument({
      metadata: { source: "runtime" },
      layers: [createSketchLayer({ id: 0, name: "Sketch" })],
      media: [toMediaReference(media)],
    });

    const result = exportSketchDocumentToGlb(document);
    const parsed = parseGlb(result.bytes);
    const mediaNode = parsed.json.nodes.find(
      (node: { extras?: Record<string, unknown> }) =>
        node.extras?.openBrushMediaId === "ref-image",
    );

    expect(result.summary).toMatchObject({
      mediaNodeCount: 1,
      meshCount: 0,
      skippedStrokeCount: 0,
    });
    expect(parsed.json.scenes[0].extras).toMatchObject({
      openBrushMediaCount: 1,
      openBrushExportedMediaNodeCount: 1,
    });
    expect(mediaNode).toMatchObject({
      name: "Reference image: reference.png",
      translation: [1, 2, 3],
      rotation: [0, 0, 0, 1],
      scale: [0.5, 0.5, 0.5],
      extras: {
        openBrushMediaPath: "media/ref-image/reference.png",
        openBrushMimeType: "image/png",
        openBrushByteLength: 3,
      },
    });
  });

  it("warns about missing media bytes without failing GLB export", () => {
    const media = createReferenceMediaAsset({
      id: "empty-model",
      kind: "model",
      fileName: "reference.glb",
      mimeType: "model/gltf-binary",
      bytes: new Uint8Array(),
    });
    const result = exportSketchDocumentToGlb(
      createSketchDocument({
        metadata: { source: "runtime" },
        media: [toMediaReference(media)],
      }),
    );

    expect(result.summary.mediaNodeCount).toBe(1);
    expect(result.summary.warnings).toEqual([
      "Media empty-model has no bytes; exported as reference metadata only.",
    ]);
    expect(parseGlb(result.bytes).json.scenes[0].extras.openBrushMediaCount).toBe(
      1,
    );
  });
});

function parseGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(view.getUint32(0, true)).toBe(0x46546c67);
  const version = view.getUint32(4, true);
  const totalLength = view.getUint32(8, true);
  let offset = 12;
  const jsonLength = view.getUint32(offset, true);
  offset += 4;
  expect(view.getUint32(offset, true)).toBe(0x4e4f534a);
  offset += 4;
  const jsonBytes = bytes.slice(offset, offset + jsonLength);
  offset += jsonLength;
  const binLength = view.getUint32(offset, true);
  offset += 4;
  expect(view.getUint32(offset, true)).toBe(0x004e4942);
  offset += 4;
  const binBytes = bytes.slice(offset, offset + binLength);
  expect(offset + binLength).toBe(totalLength);
  const json = JSON.parse(new TextDecoder().decode(jsonBytes).trim());
  return { version, totalLength, jsonLength, binLength, binBytes, json };
}
