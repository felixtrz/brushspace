import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { requiredOpenBrushes } from "../src/brushes/brush-catalog.js";
import brushAssets from "../src/brushes/generated/brush-assets.json" with {
  type: "json",
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const authoritativeRoot = path.join(
  root,
  "vendor",
  "icosa-sketch-assets",
  "brushes",
);

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

function declarations(source, qualifier) {
  const result = new Map();
  const pattern = new RegExp(
    `^\\s*${qualifier}\\s+(?:(?:lowp|mediump|highp)\\s+)?(\\w+)\\s+(\\w+)\\s*;`,
    "gm",
  );
  for (const match of stripComments(source).matchAll(pattern)) {
    result.set(match[2], match[1]);
  }
  return result;
}

function isUsed(source, name) {
  const uncommented = stripComments(source).replace(
    /^\s*in\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+\w+\s*;/gm,
    "",
  );
  return new RegExp(`\\b${name}\\b`).test(uncommented);
}

function emittedVertexAttributes(entry) {
  const uv0Components =
    entry.generatorClass === "GeniusParticlesBrush"
      ? 4
      : entry.geometryParams?.tubeStoreRadiusInTexcoord0Z === true ||
          entry.geometryFamily === "hull" ||
          entry.geometryFamily === "concave-hull"
        ? 3
        : 2;
  const attributes = new Map([
    ["a_position", 3],
    ["a_normal", 3],
    ["a_color", 4],
    ["a_texcoord0", uv0Components],
    ["a_tangent", 4],
  ]);
  if (
    entry.geometryParams?.ribbonOffsetInTexcoord1 === true ||
    entry.generatorClass === "GeniusParticlesBrush"
  ) {
    attributes.set(
      "a_texcoord1",
      entry.generatorClass === "GeniusParticlesBrush" ? 4 : 3,
    );
  } else if (entry.generatorClass === "MidpointPlusLifetimeSprayBrush") {
    attributes.set("a_texcoord1", 4);
    attributes.set("a_timestamp", 1);
  }
  if (entry.name === "LeakyPen") {
    // Unity's uv_SecondaryTex surface input is UV0 transformed by
    // _SecondaryTex_ST, rather than a second generated UV set.
    attributes.set("a_texcoord1", 2);
  }
  return attributes;
}

function componentCount(type) {
  const vector = /^vec([234])$/.exec(type);
  return vector ? Number(vector[1]) : type === "float" ? 1 : undefined;
}

const authoritativeFolders = fs
  .readdirSync(authoritativeRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== "legacy")
  .map((entry) => entry.name);

const requiredBrushes = requiredOpenBrushes.map((entry) => [
  entry,
  brushAssets.brushes[entry.guid],
]);

const knownGeneratedMeshContractGaps = new Map();

function resolveShaderPair(name) {
  const prefix = `${name}-`.toLowerCase();
  const folderName = authoritativeFolders.find((candidate) =>
    candidate.toLowerCase().startsWith(prefix),
  );
  if (!folderName) {
    return undefined;
  }
  const folder = path.join(authoritativeRoot, folderName);
  const files = fs.readdirSync(folder);
  return {
    folder,
    vertex: files.find((file) => file.endsWith("-vertex.glsl")),
    fragment: files.find((file) => file.endsWith("-fragment.glsl")),
  };
}

function readShaderPair(name) {
  const pair = resolveShaderPair(name);
  expect(pair, `missing authoritative shader folder for ${name}`).toBeDefined();
  return {
    vertex: fs.readFileSync(path.join(pair.folder, pair.vertex), "utf8"),
    fragment: fs.readFileSync(path.join(pair.folder, pair.fragment), "utf8"),
  };
}

describe("authoritative required-brush shader interfaces", () => {
  it("covers the 48 standard and 47 experimental brush target", () => {
    const standard = requiredBrushes.filter(
      ([entry]) => entry.catalogSection === "standard",
    );
    const experimental = requiredBrushes.filter(
      ([entry]) => entry.catalogSection === "experimental",
    );
    expect(standard).toHaveLength(48);
    expect(experimental).toHaveLength(47);
  });

  it("preserves the repaired Digital and Race grid logic", () => {
    const digital = readShaderPair("Digital");
    const race = readShaderPair("Race");

    for (const shader of [digital, race]) {
      expect(shader.vertex).toContain("v_st.x *= 5.0");
      expect(shader.vertex).toContain("v_st *= 5.0");
      expect(shader.fragment).toContain("vec2 tileSt = (fract(v_st) - 0.5) * 2.0");
      expect(shader.fragment).toContain("minBound.x, tileSt.x");
      expect(shader.fragment).toContain("minBound.y, tileSt.y");
    }

    expect(digital.fragment).toContain(
      "random(rc) + random(rc + ij) < 1.0",
    );
    expect(race.fragment).toContain(
      "float threshold = ii == 0 ? 1.5 : 0.5",
    );
    expect(race.fragment).toContain(
      "random(rc) + random(rc + ij) < threshold",
    );
  });

  it.todo("restore reviewed TubeToonInverted vertex behavior upstream");
  it.todo("restore reviewed SingleSided diffuse texture cutout upstream");
  it.todo("restore reviewed DoubleFlat diffuse texture cutout upstream");
  it.todo("restore reviewed Space simplex FBM upstream");

  it.each(requiredBrushes)(
    "$0.name links active fragment varyings to its vertex stage",
    (entry, record) => {
      expect(record, `missing asset record for ${entry.guid}`).toBeDefined();
      const pair = resolveShaderPair(entry.name);
      expect(pair, `missing authoritative shader folder for ${entry.name}`).toBeDefined();
      const vertexPath = path.join(pair.folder, pair.vertex ?? "");
      const fragmentPath = path.join(pair.folder, pair.fragment ?? "");
      expect(fs.existsSync(vertexPath), vertexPath).toBe(true);
      expect(fs.existsSync(fragmentPath), fragmentPath).toBe(true);

      const vertexSource = fs.readFileSync(vertexPath, "utf8");
      const fragmentSource = fs.readFileSync(fragmentPath, "utf8");
      const vertexOutputs = declarations(vertexSource, "out");
      const vertexInputs = declarations(vertexSource, "in");
      const fragmentInputs = declarations(fragmentSource, "in");
      const mismatches = [];

      for (const [name, fragmentType] of fragmentInputs) {
        if (!isUsed(fragmentSource, name)) {
          continue;
        }
        const vertexType = vertexOutputs.get(name);
        if (vertexType !== fragmentType) {
          mismatches.push(
            `${name}: fragment ${fragmentType}, vertex ${vertexType ?? "missing"}`,
          );
        }
      }

      const emittedAttributes = emittedVertexAttributes(entry);
      for (const [name, type] of vertexInputs) {
        const newerExporterFallback =
          vertexSource.includes("u_isNewTiltExporter") &&
          (name === "a_texcoord2" ||
            (name === "a_texcoord1" &&
              entry.geometryParams?.tubeStoreRadiusInTexcoord0Z === true));
        if (
          name.startsWith("a_") &&
          isUsed(vertexSource, name) &&
          !newerExporterFallback
        ) {
          const emittedComponents = emittedAttributes.get(name);
          if (emittedComponents === undefined) {
            mismatches.push(`${name}: active vertex input is not emitted`);
            continue;
          }
          const requiredComponents = componentCount(type);
          if (
            name !== "a_position" &&
            requiredComponents !== undefined &&
            emittedComponents < requiredComponents
          ) {
            mismatches.push(
              `${name}: shader needs ${requiredComponents} components, geometry emits ${emittedComponents}`,
            );
          }
        }
      }

      expect(mismatches, entry.name).toEqual(
        knownGeneratedMeshContractGaps.get(entry.name) ?? [],
      );
    },
  );
});
