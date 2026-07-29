import { generateBrushGeometry } from "../brushes/brush-geometry.js";
import { openBrushInventory } from "../brushes/brush-catalog.js";
import { findBrushByGuid } from "../brushes/brush-inventory.js";
import { createBrushMaterialSpec } from "../brushes/brush-materials.js";
import type { SketchDocument, SketchLayer } from "./document.js";
import { isManagedMediaPath } from "./media-assets.js";
import type { Rgba, StrokeData } from "../types.js";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

const COMPONENT_FLOAT = 5126;
const COMPONENT_UNSIGNED_INT = 5125;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;

export interface GlbExportSummary {
  meshCount: number;
  materialCount: number;
  nodeCount: number;
  mediaNodeCount: number;
  triangleCount: number;
  skippedStrokeCount: number;
  warnings: string[];
}

export interface GlbExportResult {
  bytes: Uint8Array;
  fileName: string;
  mimeType: "model/gltf-binary";
  json: GlbDocument;
  summary: GlbExportSummary;
}

interface GlbDocument {
  asset: {
    version: "2.0";
    generator: string;
  };
  scene: number;
  scenes: GlbScene[];
  nodes: GlbNode[];
  meshes: GlbMesh[];
  materials: GlbMaterial[];
  buffers: GlbBuffer[];
  bufferViews: GlbBufferView[];
  accessors: GlbAccessor[];
}

interface GlbScene {
  nodes: number[];
  extras: Record<string, unknown>;
}

interface GlbNode {
  name: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: Record<string, unknown>;
}

interface GlbMesh {
  name: string;
  primitives: GlbPrimitive[];
  extras: Record<string, unknown>;
}

interface GlbPrimitive {
  attributes: Record<string, number>;
  indices: number;
  material: number;
  mode: number;
  extras: Record<string, unknown>;
}

interface GlbMaterial {
  name: string;
  pbrMetallicRoughness: {
    baseColorFactor: Rgba;
    metallicFactor: number;
    roughnessFactor: number;
  };
  alphaMode?: "BLEND" | "MASK";
  doubleSided: boolean;
  extras: Record<string, unknown>;
}

interface GlbBuffer {
  byteLength: number;
}

interface GlbBufferView {
  buffer: number;
  byteOffset: number;
  byteLength: number;
  target?: number;
}

interface GlbAccessor {
  bufferView: number;
  byteOffset: number;
  componentType: number;
  count: number;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
  min?: number[];
  max?: number[];
}

export function exportSketchDocumentToGlb(
  document: SketchDocument,
  fileName = "open-brush-sketch.glb",
): GlbExportResult {
  const writer = new BinaryChunkWriter();
  const nodes: GlbNode[] = [];
  const meshes: GlbMesh[] = [];
  const materials: GlbMaterial[] = [];
  const bufferViews: GlbBufferView[] = [];
  const accessors: GlbAccessor[] = [];
  const warnings: string[] = [];
  const layerNodes = new Map<number, number>();
  let triangleCount = 0;
  let skippedStrokeCount = 0;

  for (const layer of document.layers) {
    layerNodes.set(layer.id, nodes.length);
    nodes.push(createLayerNode(layer));
  }

  for (const stroke of document.strokes) {
    const layerNodeIndex = layerNodes.get(stroke.layerIndex);
    if (layerNodeIndex === undefined) {
      warnings.push(
        `Skipped stroke ${stroke.guid}: missing layer ${stroke.layerIndex}.`,
      );
      skippedStrokeCount += 1;
      continue;
    }

    const brush = findBrushByGuid(openBrushInventory, stroke.brushGuid);
    const geometryFamily = brush?.geometryFamily ?? "unsupported";
    const materialSpec = createBrushMaterialSpec(brush, stroke.color);
    const geometry = generateBrushGeometry(stroke, geometryFamily, {
      pressureSizeRange: brush?.pressureSizeRange,
      pressureOpacityRange: brush?.pressureOpacityRange,
      geometryParams: brush?.geometryParams,
      generatorClass: brush?.generatorClass,
    });
    const vertexCount = geometry.positions.length / 3;
    if (vertexCount === 0 || geometry.indices.length === 0) {
      warnings.push(`Skipped stroke ${stroke.guid}: no generated triangles.`);
      skippedStrokeCount += 1;
      continue;
    }
    if (geometry.warning) {
      warnings.push(`Stroke ${stroke.guid}: ${geometry.warning}`);
    }
    if (materialSpec.warning) {
      warnings.push(`Stroke ${stroke.guid}: ${materialSpec.warning}`);
    }

    const positionAccessor = addAccessor(
      writer,
      bufferViews,
      accessors,
      geometry.positions,
      COMPONENT_FLOAT,
      "VEC3",
      ARRAY_BUFFER,
      geometry.bounds.min,
      geometry.bounds.max,
    );
    const normalAccessor = addAccessor(
      writer,
      bufferViews,
      accessors,
      geometry.normals,
      COMPONENT_FLOAT,
      "VEC3",
      ARRAY_BUFFER,
    );
    const colorAccessor = addAccessor(
      writer,
      bufferViews,
      accessors,
      geometry.colors,
      COMPONENT_FLOAT,
      "VEC4",
      ARRAY_BUFFER,
    );
    const tangentAccessor = addAccessor(
      writer,
      bufferViews,
      accessors,
      geometry.tangents,
      COMPONENT_FLOAT,
      "VEC4",
      ARRAY_BUFFER,
    );
    const uvAccessor = addAccessor(
      writer,
      bufferViews,
      accessors,
      geometry.uvs,
      COMPONENT_FLOAT,
      "VEC2",
      ARRAY_BUFFER,
    );
    const packedUvAccessor = geometry.packedUvs
      ? addAccessor(
          writer,
          bufferViews,
          accessors,
          geometry.packedUvs,
          COMPONENT_FLOAT,
          "VEC3",
          ARRAY_BUFFER,
        )
      : undefined;
    const indexAccessor = addAccessor(
      writer,
      bufferViews,
      accessors,
      geometry.indices,
      COMPONENT_UNSIGNED_INT,
      "SCALAR",
      ELEMENT_ARRAY_BUFFER,
    );
    const materialIndex = materials.length;
    materials.push({
      name: brush?.name ?? `Fallback ${stroke.brushGuid}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...stroke.color] as Rgba,
        metallicFactor: 0,
        roughnessFactor: 0.85,
      },
      alphaMode: materialSpec.transparent ? "BLEND" : undefined,
      doubleSided: materialSpec.doubleSided,
      extras: {
        openBrushBrushGuid: stroke.brushGuid,
        openBrushBrushName: brush?.name ?? "",
        openBrushMaterialFamily: materialSpec.materialFamily,
        openBrushShaderRewrite: materialSpec.shaderRewrite,
      },
    });
    const strokeTriangleCount = geometry.indices.length / 3;
    triangleCount += strokeTriangleCount;
    const meshIndex = meshes.length;
    meshes.push({
      name: `Stroke ${stroke.guid}`,
      primitives: [
        {
          attributes: {
            POSITION: positionAccessor,
            NORMAL: normalAccessor,
            TANGENT: tangentAccessor,
            COLOR_0: colorAccessor,
            TEXCOORD_0: uvAccessor,
            ...(packedUvAccessor === undefined
              ? {}
              : { _TB_TEXCOORD_0: packedUvAccessor }),
          },
          indices: indexAccessor,
          material: materialIndex,
          mode: TRIANGLES,
          extras: {
            openBrushStrokeGuid: stroke.guid,
            openBrushBrushGuid: stroke.brushGuid,
            openBrushLayerIndex: stroke.layerIndex,
            openBrushTriangleCount: strokeTriangleCount,
          },
        },
      ],
      extras: {
        openBrushStrokeGuid: stroke.guid,
        openBrushBrushGuid: stroke.brushGuid,
        openBrushBrushName: brush?.name ?? "",
        openBrushLayerIndex: stroke.layerIndex,
        openBrushGeometryFamily: geometry.family,
        openBrushMaterialFamily: materialSpec.materialFamily,
        openBrushControlPointCount: stroke.controlPoints.length,
        openBrushSeed: stroke.seed,
        openBrushGroupId: stroke.groupId,
        openBrushTriangleCount: strokeTriangleCount,
      },
    });
    const strokeNodeIndex = nodes.length;
    nodes.push({
      name: `Stroke ${stroke.guid}`,
      mesh: meshIndex,
      extras: {
        openBrushStrokeGuid: stroke.guid,
        openBrushLayerIndex: stroke.layerIndex,
      },
    });
    nodes[layerNodeIndex].children ??= [];
    nodes[layerNodeIndex].children.push(strokeNodeIndex);
  }

  const rootNodeIndices = [...layerNodes.values()];
  let mediaNodeCount = 0;
  for (const media of document.media) {
    if (!isManagedMediaPath(media.mediaPath)) {
      warnings.push(
        `Media ${media.id} uses unmanaged path ${media.mediaPath}; exported as metadata only.`,
      );
    }
    if (media.byteLength === 0) {
      warnings.push(
        `Media ${media.id} has no bytes; exported as reference metadata only.`,
      );
    }
    const nodeIndex = nodes.length;
    nodes.push({
      name: `Reference ${media.kind}: ${media.originalName}`,
      translation: [...media.transform.position],
      rotation: [...media.transform.rotation],
      scale: [...media.transform.scale],
      extras: {
        openBrushMediaId: media.id,
        openBrushMediaKind: media.kind,
        openBrushMediaPath: media.mediaPath,
        openBrushOriginalName: media.originalName,
        openBrushMimeType: media.mimeType,
        openBrushByteLength: media.byteLength,
      },
    });
    rootNodeIndices.push(nodeIndex);
    mediaNodeCount += 1;
  }

  const binChunk = writer.toUint8Array();
  const json: GlbDocument = {
    asset: {
      version: "2.0",
      generator: "Brushspace",
    },
    scene: 0,
    scenes: [
      {
        nodes: rootNodeIndices,
        extras: {
          TB_Application: "Brushspace",
          TB_SchemaVersion: document.metadata.schemaVersion,
          TB_Source: document.metadata.source,
          openBrushLayerCount: document.layers.length,
          openBrushStrokeCount: document.strokes.length,
          openBrushMediaCount: document.media.length,
          openBrushExportedStrokeCount: meshes.length,
          openBrushExportedMediaNodeCount: mediaNodeCount,
          openBrushTriangleCount: triangleCount,
        },
      },
    ],
    nodes,
    meshes,
    materials,
    buffers: [{ byteLength: binChunk.byteLength }],
    bufferViews,
    accessors,
  };
  const bytes = writeGlb(json, binChunk);
  return {
    bytes,
    fileName,
    mimeType: "model/gltf-binary",
    json,
    summary: {
      meshCount: meshes.length,
      materialCount: materials.length,
      nodeCount: nodes.length,
      mediaNodeCount,
      triangleCount,
      skippedStrokeCount,
      warnings,
    },
  };
}

function createLayerNode(layer: SketchLayer): GlbNode {
  return {
    name: `Layer ${layer.id}: ${layer.name}`,
    children: [],
    extras: {
      openBrushLayerId: layer.id,
      openBrushLayerName: layer.name,
      openBrushLayerVisible: layer.visible,
      openBrushLayerLocked: layer.locked,
    },
  };
}

function addAccessor(
  writer: BinaryChunkWriter,
  bufferViews: GlbBufferView[],
  accessors: GlbAccessor[],
  data: Float32Array | Uint32Array,
  componentType: number,
  type: GlbAccessor["type"],
  target: number,
  min?: number[],
  max?: number[],
): number {
  const byteOffset = writer.append(data);
  const bufferViewIndex = bufferViews.length;
  bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: data.byteLength,
    target,
  });
  const accessorIndex = accessors.length;
  accessors.push({
    bufferView: bufferViewIndex,
    byteOffset: 0,
    componentType,
    count: getAccessorCount(data, type),
    type,
    min,
    max,
  });
  return accessorIndex;
}

function getAccessorCount(
  data: Float32Array | Uint32Array,
  type: GlbAccessor["type"],
): number {
  switch (type) {
    case "SCALAR":
      return data.length;
    case "VEC2":
      return data.length / 2;
    case "VEC3":
      return data.length / 3;
    case "VEC4":
      return data.length / 4;
  }
}

function writeGlb(json: GlbDocument, binChunk: Uint8Array): Uint8Array {
  const jsonChunk = encodeJsonChunk(json);
  const alignedBinChunk = alignChunk(binChunk, 0);
  const totalLength = 12 + 8 + jsonChunk.byteLength + 8 + alignedBinChunk.byteLength;
  const output = new Uint8Array(totalLength);
  const view = new DataView(output.buffer);
  let offset = 0;

  view.setUint32(offset, GLB_MAGIC, true);
  offset += 4;
  view.setUint32(offset, GLB_VERSION, true);
  offset += 4;
  view.setUint32(offset, totalLength, true);
  offset += 4;
  view.setUint32(offset, jsonChunk.byteLength, true);
  offset += 4;
  view.setUint32(offset, GLB_JSON_CHUNK, true);
  offset += 4;
  output.set(jsonChunk, offset);
  offset += jsonChunk.byteLength;
  view.setUint32(offset, alignedBinChunk.byteLength, true);
  offset += 4;
  view.setUint32(offset, GLB_BIN_CHUNK, true);
  offset += 4;
  output.set(alignedBinChunk, offset);

  return output;
}

function encodeJsonChunk(json: GlbDocument): Uint8Array {
  return alignChunk(new TextEncoder().encode(JSON.stringify(json)), 0x20);
}

function alignChunk(bytes: Uint8Array, paddingByte: number): Uint8Array {
  const paddingLength = (4 - (bytes.byteLength % 4)) % 4;
  if (paddingLength === 0) {
    return bytes;
  }
  const output = new Uint8Array(bytes.byteLength + paddingLength);
  output.set(bytes, 0);
  output.fill(paddingByte, bytes.byteLength);
  return output;
}

class BinaryChunkWriter {
  private readonly chunks: Uint8Array[] = [];
  private byteLength = 0;

  append(data: Float32Array | Uint32Array): number {
    this.align();
    const byteOffset = this.byteLength;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const chunk = new Uint8Array(bytes);
    this.chunks.push(chunk);
    this.byteLength += chunk.byteLength;
    return byteOffset;
  }

  toUint8Array(): Uint8Array {
    this.align();
    const output = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }

  private align(): void {
    const paddingLength = (4 - (this.byteLength % 4)) % 4;
    if (paddingLength === 0) {
      return;
    }
    const padding = new Uint8Array(paddingLength);
    this.chunks.push(padding);
    this.byteLength += paddingLength;
  }
}
