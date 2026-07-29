#!/usr/bin/env node
// Extracts Open Brush brush-rendering assets from the reference checkout into
// the app, so the runtime never depends on `reference/` being present.
//
// Outputs:
//   public/openbrush/shaders/<vertex|fragment>.glsl   (includes resolved, defines injected)
//   public/openbrush/textures/<manifest texture name>  (copied from Unity brush folders)
//   public/openbrush/NOTICE
//   src/brushes/generated/exportManifest.json        (verbatim copy, bundled)
//   src/brushes/generated/brush-assets.json          (per-GUID shader/texture/geometry metadata)
//
// Shader generation mirrors reference/Support/bin/gltf_export_shaders.py:
// handcrafted generator files are used when present; otherwise the same
// template selection the official tiltbrush.com pipeline used is applied
// (VertDefault + FragAdditive/FragUnlit/FragDiffuse/FragStandard).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const referenceRoot = path.join(repoRoot, "reference");
const referenceMetadata = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "open-brush-reference.json"), "utf8"),
);
const referenceCommit = execFileSync(
  "git",
  ["-C", referenceRoot, "rev-parse", "HEAD"],
  { encoding: "utf8" },
).trim();
if (referenceCommit !== referenceMetadata.commit) {
  throw new Error(
    `Open Brush reference checkout is ${referenceCommit}; expected ${referenceMetadata.commit}.`,
  );
}
const generatorsDir = path.join(referenceRoot, "Support", "GlTFShaders", "Generators");
const includeDir = path.join(referenceRoot, "Support", "GlTFShaders", "include");
const manifestPath = path.join(referenceRoot, "Support", "exportManifest.json");
const standardBrushManifestPath = path.join(referenceRoot, "Assets", "Manifest.asset");
const experimentalBrushManifestPath = path.join(
  referenceRoot,
  "Assets",
  "Manifest_Experimental.asset",
);
const brushAssetRoots = [
  path.join(referenceRoot, "Assets", "Resources", "Brushes"),
  path.join(referenceRoot, "Assets", "Resources", "X"),
];
// Extra roots scanned for the GUID→file index only (some brush materials
// reference shared textures that live outside the brush folders, and brush
// prefabs live in Assets/Resources/BrushPrefabs).
const metaIndexRoots = [
  ...brushAssetRoots,
  path.join(referenceRoot, "Assets", "Textures"),
  path.join(referenceRoot, "Assets", "Resources", "BrushPrefabs"),
];
const scriptIndexRoot = path.join(referenceRoot, "Assets", "Scripts");

const outPublicDir = path.join(repoRoot, "public", "openbrush");
const outShaderDir = path.join(outPublicDir, "shaders");
const outTextureDir = path.join(outPublicDir, "textures");
const outIconDir = path.join(outPublicDir, "icons");
const outGeneratedDir = path.join(repoRoot, "src", "brushes", "generated");

// ---------------------------------------------------------------------------
// GLSL preprocessing (port of preprocess_lite from gltf_export_shaders.py)
// ---------------------------------------------------------------------------

const INCLUDE_PATTERN = /^[ \t]*#[ \t]*include[ \t]+(["<])(.*)[">].*$\n?/gm;

function expandIncludes(filePath, seenStack = []) {
  if (seenStack.includes(filePath)) {
    throw new Error(`Circular #include involving ${filePath}`);
  }
  let text = fs.readFileSync(filePath, "utf8");
  if (!text.endsWith("\n")) {
    text += "\n";
  }
  return text.replace(INCLUDE_PATTERN, (_match, _quote, includeName) => {
    const searchDirs = [path.dirname(filePath), includeDir];
    for (const dir of searchDirs) {
      const candidate = path.join(dir, includeName);
      if (fs.existsSync(candidate)) {
        return expandIncludes(candidate, [...seenStack, filePath]);
      }
    }
    throw new Error(`${filePath}: cannot resolve #include "${includeName}"`);
  });
}

function getDefines(brush) {
  const defines = {};
  const floatParams = brush.floatParams ?? {};
  // FragAdditive requires the macro even when the legacy export manifest did
  // not serialize the material value. Open Brush's additive template default
  // is 0.5; leaving it undefined makes those brushes fail shader compilation.
  defines.TB_EMISSION_GAIN = String(
    typeof floatParams.EmissionGain === "number" ? floatParams.EmissionGain : 0.5,
  );
  if (typeof floatParams.Cutoff === "number") {
    defines.TB_ALPHA_CUTOFF = String(floatParams.Cutoff);
    defines.TB_HAS_ALPHA_CUTOFF = floatParams.Cutoff < 1 ? "1" : "0";
  } else {
    defines.TB_HAS_ALPHA_CUTOFF = "0";
  }
  return defines;
}

function injectDefines(contents, defines) {
  const lines = Object.entries(defines)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .filter(([name]) => contents.includes(name))
    .map(([name, value]) => `#define ${name} ${value}\n`);
  return lines.join("") + contents;
}

// Template selection, ported verbatim from gltf_export_shaders.py.
function getFragTemplate(brush) {
  if (Number(brush.blendMode) === 2) {
    return "FragAdditive.glsl";
  }
  if ("OutlineMax" in (brush.floatParams ?? {})) {
    return "FragDiffuse.glsl";
  }
  if (!("Color" in (brush.colorParams ?? {}))) {
    return "FragUnlit.glsl";
  }
  if (!("Shininess" in (brush.floatParams ?? {}))) {
    return "FragDiffuse.glsl";
  }
  return "FragStandard.glsl";
}

function stripCommentsAndWhitespace(glsl) {
  return glsl
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, "");
}

// ---------------------------------------------------------------------------
// Unity asset scanning (meta GUID index, BrushDescriptor .asset, .mat)
// ---------------------------------------------------------------------------

function walkFiles(root, visit) {
  if (!fs.existsSync(root)) {
    return;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, visit);
    } else if (entry.isFile()) {
      visit(fullPath);
    }
  }
}

function buildMetaGuidIndex() {
  const index = new Map();
  for (const root of metaIndexRoots) {
    walkFiles(root, (filePath) => {
      if (!filePath.endsWith(".meta")) {
        return;
      }
      const match = fs.readFileSync(filePath, "utf8").match(/^guid: ([0-9a-f]{32})$/m);
      if (match) {
        index.set(match[1], filePath.slice(0, -".meta".length));
      }
    });
  }
  return index;
}

function parseYamlScalar(text, fieldName) {
  const match = text.match(new RegExp(`^\\s*${fieldName}: (.+)$`, "m"));
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : match[1].trim();
}

function parseYamlVec2(text, fieldName) {
  const match = text.match(
    new RegExp(`^\\s*${fieldName}: \\{x: ([-0-9.e]+), y: ([-0-9.e]+)\\}$`, "m"),
  );
  return match ? [Number(match[1]), Number(match[2])] : undefined;
}

function collectBrushDescriptors() {
  const descriptors = new Map();
  for (const root of brushAssetRoots) {
    walkFiles(root, (filePath) => {
      if (!filePath.endsWith(".asset")) {
        return;
      }
      const text = fs.readFileSync(filePath, "utf8");
      const guidMatch = text.match(/^\s*m_Guid:\s*\n\s*m_storage: ([0-9a-fA-F-]{36})$/m);
      if (!guidMatch) {
        return;
      }
      const materialMatch = text.match(
        /m_Material: \{fileID: \d+, guid: ([0-9a-f]{32}),\s+type: \d+\}/,
      );
      const supersedesMatch = text.match(
        /m_Supersedes: \{fileID: \d+, guid: ([0-9a-f]{32}),\s+type: \d+\}/,
      );
      const metaPath = `${filePath}.meta`;
      const metaGuidMatch = fs.existsSync(metaPath)
        ? fs.readFileSync(metaPath, "utf8").match(/^guid: ([0-9a-f]{32})$/m)
        : null;
      descriptors.set(guidMatch[1].toLowerCase(), {
        assetPath: filePath,
        assetMetaGuid: metaGuidMatch ? metaGuidMatch[1] : undefined,
        materialGuid: materialMatch ? materialMatch[1] : undefined,
        supersedesAssetGuid: supersedesMatch ? supersedesMatch[1] : undefined,
        text,
      });
    });
  }
  return descriptors;
}

function extractManifestBrushAssetGuids(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const brushesBlock = text.match(/^  Brushes:\s*\n([\s\S]*?)(?=^  \w|\Z)/m)?.[1] ?? "";
  return Array.from(
    brushesBlock.matchAll(/^\s*- \{fileID: \d+, guid: ([0-9a-f]{32}), type: \d+\}$/gm),
    (match) => match[1],
  );
}

function buildBrushCatalogPositions(descriptors) {
  const brushGuidByAssetGuid = new Map();
  for (const [brushGuid, descriptor] of descriptors) {
    if (descriptor.assetMetaGuid) {
      brushGuidByAssetGuid.set(descriptor.assetMetaGuid, brushGuid);
    }
  }
  const positions = new Map();
  for (const [section, manifestAssetPath] of [
    ["standard", standardBrushManifestPath],
    ["experimental", experimentalBrushManifestPath],
  ]) {
    extractManifestBrushAssetGuids(manifestAssetPath).forEach((assetGuid, order) => {
      const brushGuid = brushGuidByAssetGuid.get(assetGuid);
      if (brushGuid) {
        positions.set(brushGuid, { section, order });
      }
    });
  }
  return positions;
}

/** Map Unity script GUID → C# class name (file basename) for Assets/Scripts. */
function buildScriptGuidIndex() {
  const index = new Map();
  walkFiles(scriptIndexRoot, (filePath) => {
    if (!filePath.endsWith(".cs.meta")) {
      return;
    }
    const match = fs.readFileSync(filePath, "utf8").match(/^guid: ([0-9a-f]{32})$/m);
    if (match) {
      index.set(match[1], path.basename(filePath, ".cs.meta"));
    }
  });
  return index;
}

// Geometry generator classes (BaseBrushScript subclasses) → port geometry family.
const GENERATOR_CLASS_FAMILIES = {
  QuadStripBrushStretchUV: "ribbon",
  QuadStripBrushDistanceUV: "ribbon",
  QuadStripUnitizedUVBrush: "ribbon",
  FlatGeometryBrush: "ribbon",
  TubeBrush: "tube",
  GeniusParticlesBrush: "particle",
  SprayBrush: "particle",
  MidpointPlusLifetimeSprayBrush: "particle",
  SquareBrush: "quad-stamp",
  ThickGeometryBrush: "thick-strip",
  GeometryBrush: "geometry",
  HullBrush: "hull",
  ConcaveHullBrush: "hull",
};

/**
 * Resolves the geometry generator class for a brush by following
 * m_BrushPrefab → prefab MonoBehaviour m_Script GUIDs → class names,
 * keeping the first class with a known family mapping.
 */
function resolveGenerator(descriptorText, metaGuidIndex, scriptGuidIndex) {
  const prefabMatch = descriptorText.match(
    /m_BrushPrefab: \{fileID: \d+, guid: ([0-9a-f]{32}),\s+type: \d+\}/,
  );
  if (!prefabMatch) {
    return undefined;
  }
  const prefabPath = metaGuidIndex.get(prefabMatch[1]);
  if (!prefabPath || !fs.existsSync(prefabPath)) {
    return undefined;
  }
  const prefabText = fs.readFileSync(prefabPath, "utf8");
  const classNames = [];
  for (const match of prefabText.matchAll(
    /m_Script: \{fileID: \d+, guid: ([0-9a-f]{32}),\s+type: \d+\}/g,
  )) {
    const className = scriptGuidIndex.get(match[1]);
    if (className) {
      classNames.push(className);
    }
  }
  const generatorClass =
    classNames.find((name) => name in GENERATOR_CLASS_FAMILIES) ?? classNames[0];
  return generatorClass ? { generatorClass, prefabText } : undefined;
}

function parseMaterialTextures(matText) {
  // m_TexEnvs entries look like:
  //   - _MainTex:
  //       m_Texture: {fileID: 2800000, guid: <hex32>, type: 3}
  const textures = new Map();
  const pattern =
    /- _(\w+):\s*\n\s*m_Texture: \{fileID: (-?\d+), guid: ([0-9a-f]{32})(?:,\s+type: \d+)?\}/g;
  for (const match of matText.matchAll(pattern)) {
    const [, param, fileId, guid] = match;
    if (Number(fileId) !== 0) {
      textures.set(param, guid);
    }
  }
  return textures;
}

/** Parse the descriptor's m_Tags list (e.g. ["default", "audioreactive"]). */
function extractBrushTags(descriptorText) {
  const match = descriptorText.match(/^\s*m_Tags:\s*\n((?:\s*- .+\n)+)/m);
  if (!match) {
    return [];
  }
  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter(Boolean);
}

function extractGeometryParams(descriptorText) {
  return {
    tileRate: parseYamlScalar(descriptorText, "m_TileRate"),
    textureAtlasV: parseYamlScalar(descriptorText, "m_TextureAtlasV"),
    renderBackfaces: parseYamlScalar(descriptorText, "m_RenderBackfaces") === 1,
    backfaceHueShift: parseYamlScalar(descriptorText, "m_BackfaceHueShift"),
    tubeStoreRadiusInTexcoord0Z:
      parseYamlScalar(descriptorText, "m_TubeStoreRadiusInTexcoord0Z") === 1,
    opacity: parseYamlScalar(descriptorText, "m_Opacity"),
    solidMinLengthMeters: parseYamlScalar(descriptorText, "m_SolidMinLengthMeters_PS"),
    audioReactive: parseYamlScalar(descriptorText, "m_AudioReactive") === 1,
    colorLuminanceMin: parseYamlScalar(descriptorText, "m_ColorLuminanceMin"),
    colorSaturationMax: parseYamlScalar(descriptorText, "m_ColorSaturationMax"),
    brushSizeRange: parseYamlVec2(descriptorText, "m_BrushSizeRange"),
    pressureSizeRange: parseYamlVec2(descriptorText, "m_PressureSizeRange"),
    pressureOpacityRange: parseYamlVec2(descriptorText, "m_PressureOpacityRange"),
    m11Compatibility:
      parseYamlScalar(descriptorText, "m_M11Compatibility") === 1,
    particleRate: parseYamlScalar(descriptorText, "m_ParticleRate"),
    sprayRateMultiplier: parseYamlScalar(
      descriptorText,
      "m_SprayRateMultiplier",
    ),
    particleSpeed: parseYamlScalar(descriptorText, "m_ParticleSpeed"),
    particleInitialRotationRange: parseYamlScalar(
      descriptorText,
      "m_ParticleInitialRotationRange",
    ),
    particleRandomizeAlpha:
      parseYamlScalar(descriptorText, "m_RandomizeAlpha") === 1,
    particleSizeVariance: parseYamlScalar(descriptorText, "m_SizeVariance"),
    particlePositionVariance: parseYamlScalar(
      descriptorText,
      "m_PositionVariance",
    ),
    particleRotationVariance: parseYamlScalar(
      descriptorText,
      "m_RotationVariance",
    ),
    particleSizeRatio: parseYamlVec2(descriptorText, "m_SizeRatio"),
  };
}

function extractGeneratorGeometryParams(generator) {
  if (generator?.generatorClass === "FlatGeometryBrush") {
    const uvStyle = parseYamlScalar(generator.prefabText, "m_uvStyle");
    return {
      ribbonUvStyle: uvStyle === 1 ? "stretch" : "distance",
      ribbonOffsetInTexcoord1:
        parseYamlScalar(generator.prefabText, "m_bOffsetInTexcoord1") === 1,
    };
  }
  if (generator?.generatorClass !== "TubeBrush") {
    return {};
  }
  const prefabText = generator.prefabText;
  const uvStyle = parseYamlScalar(prefabText, "m_uvStyle");
  return {
    tubeCapAspect: parseYamlScalar(prefabText, "m_CapAspect"),
    tubeSideCount: parseYamlScalar(prefabText, "m_PointsInClosedCircle"),
    tubeEndCaps: parseYamlScalar(prefabText, "m_EndCaps") === 1,
    tubeHardEdges: parseYamlScalar(prefabText, "m_HardEdges") === 1,
    tubeUvStyle: uvStyle === 1 ? "stretch" : "distance",
    tubeShapeModifier: parseYamlScalar(prefabText, "m_ShapeModifier"),
    tubeTaperScalar: parseYamlScalar(prefabText, "m_TaperScalar"),
    tubePetalDisplacementAmount: parseYamlScalar(
      prefabText,
      "m_PetalDisplacementAmt",
    ),
    tubePetalDisplacementExponent: parseYamlScalar(
      prefabText,
      "m_PetalDisplacementExp",
    ),
    tubeBreakAngleMultiplier: parseYamlScalar(
      prefabText,
      "m_BreakAngleMultiplier",
    ),
  };
}

function extractTextureImporterSettings(sourcePath) {
  const metaPath = `${sourcePath}.meta`;
  if (!fs.existsSync(metaPath)) {
    return undefined;
  }
  const text = fs.readFileSync(metaPath, "utf8");
  const filterMode = parseYamlScalar(text, "filterMode");
  const wrapU = parseYamlScalar(text, "wrapU");
  const wrapV = parseYamlScalar(text, "wrapV");
  const aniso = parseYamlScalar(text, "aniso");
  const mipBias = parseYamlScalar(text, "mipBias");
  const toWrapMode = (value) => {
    switch (value) {
      case 1:
        return "clamp";
      case 2:
        return "mirror";
      case 3:
        return "mirror-once";
      default:
        return "repeat";
    }
  };
  return {
    sRGB: parseYamlScalar(text, "sRGBTexture") !== 0,
    mipmaps: parseYamlScalar(text, "enableMipMap") !== 0,
    filter:
      filterMode === 0 ? "point" : filterMode === 2 ? "trilinear" : "bilinear",
    wrapU: toWrapMode(wrapU),
    wrapV: toWrapMode(wrapV),
    anisotropy: typeof aniso === "number" && aniso > 0 ? aniso : 1,
    mipBias: typeof mipBias === "number" && mipBias > -100 ? mipBias : 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const brushes = Object.values(manifest.brushes);
  const iconJobs = [];

  fs.rmSync(outShaderDir, { recursive: true, force: true });
  fs.rmSync(outTextureDir, { recursive: true, force: true });
  fs.rmSync(outIconDir, { recursive: true, force: true });
  fs.mkdirSync(outShaderDir, { recursive: true });
  fs.mkdirSync(outTextureDir, { recursive: true });
  fs.mkdirSync(outIconDir, { recursive: true });
  fs.mkdirSync(outGeneratedDir, { recursive: true });

  const metaGuidIndex = buildMetaGuidIndex();
  const scriptGuidIndex = buildScriptGuidIndex();
  const descriptors = collectBrushDescriptors();
  const catalogPositions = buildBrushCatalogPositions(descriptors);
  const defaultVertexNormalized = stripCommentsAndWhitespace(
    expandIncludes(path.join(includeDir, "VertDefault.glsl")),
  );

  const assetsByGuid = {};
  const summary = {
    totalBrushes: brushes.length,
    handcraftedShaders: 0,
    templateShaders: 0,
    defaultVertexBrushes: 0,
    texturesCopied: 0,
    texturesMissing: 0,
    descriptorsMissing: 0,
  };
  const problems = [];

  for (const brush of brushes) {
    const guid = brush.guid.toLowerCase();
    const record = {
      glslSource: "template",
      vertexIsDefault: true,
      vertexShader: brush.vertexShader,
      fragmentShader: brush.fragmentShader,
      textures: {},
      geometry: undefined,
    };
    const catalogPosition = catalogPositions.get(guid);
    if (catalogPosition) {
      record.catalogSection = catalogPosition.section;
      record.catalogOrder = catalogPosition.order;
    }

    // --- shaders ---
    const defines = getDefines(brush);
    const handcraftedVertex = path.join(generatorsDir, brush.vertexShader);
    const handcraftedFragment = path.join(generatorsDir, brush.fragmentShader);
    const hasHandcrafted =
      fs.existsSync(handcraftedVertex) || fs.existsSync(handcraftedFragment);
    record.glslSource = hasHandcrafted ? "handcrafted" : "template";
    summary[hasHandcrafted ? "handcraftedShaders" : "templateShaders"] += 1;

    let vertexSource;
    if (fs.existsSync(handcraftedVertex)) {
      vertexSource = expandIncludes(handcraftedVertex);
      record.vertexIsDefault =
        stripCommentsAndWhitespace(vertexSource) === defaultVertexNormalized;
    } else {
      vertexSource = expandIncludes(path.join(includeDir, "VertDefault.glsl"));
      record.vertexIsDefault = true;
    }
    if (record.vertexIsDefault) {
      summary.defaultVertexBrushes += 1;
    }

    let fragmentSource;
    if (fs.existsSync(handcraftedFragment)) {
      fragmentSource = expandIncludes(handcraftedFragment);
    } else {
      fragmentSource = expandIncludes(path.join(includeDir, getFragTemplate(brush)));
    }

    fs.writeFileSync(
      path.join(outShaderDir, brush.vertexShader),
      injectDefines(vertexSource, defines),
    );
    fs.writeFileSync(
      path.join(outShaderDir, brush.fragmentShader),
      injectDefines(fragmentSource, defines),
    );

    // --- descriptor-driven geometry params + textures ---
    const descriptor = descriptors.get(guid);
    if (!descriptor) {
      summary.descriptorsMissing += 1;
      problems.push(`${brush.name} (${guid}): no BrushDescriptor .asset found`);
    } else {
      record.tags = extractBrushTags(descriptor.text);
      // Brush picker button icon (BrushDescriptor.m_ButtonTexture).
      const buttonTextureMatch = descriptor.text.match(
        /m_ButtonTexture: \{fileID: \d+, guid: ([0-9a-f]{32}),\s+type: \d+\}/,
      );
      const buttonTexturePath = buttonTextureMatch
        ? metaGuidIndex.get(buttonTextureMatch[1])
        : undefined;
      if (buttonTexturePath && fs.existsSync(buttonTexturePath)) {
        const iconName = `${guid}.png`;
        iconJobs.push({
          source: buttonTexturePath,
          destination: path.join(outIconDir, iconName),
        });
        record.buttonIcon = iconName;
      } else {
        problems.push(`${brush.name} (${guid}): button icon unresolved`);
      }
      const generator = resolveGenerator(
        descriptor.text,
        metaGuidIndex,
        scriptGuidIndex,
      );
      const generatorClass = generator?.generatorClass;
      record.geometry = {
        ...extractGeometryParams(descriptor.text),
        ...extractGeneratorGeometryParams(generator),
      };
      record.generatorClass = generatorClass;
      record.generatorFamily = generatorClass
        ? GENERATOR_CLASS_FAMILIES[generatorClass]
        : undefined;
      if (!generatorClass) {
        problems.push(`${brush.name} (${guid}): brush prefab generator class unresolved`);
      }
    }

    const materialPath = descriptor?.materialGuid
      ? metaGuidIndex.get(descriptor.materialGuid)
      : undefined;
    const materialTextures =
      materialPath && fs.existsSync(materialPath)
        ? parseMaterialTextures(fs.readFileSync(materialPath, "utf8"))
        : new Map();

    for (const [param, targetName] of Object.entries(brush.textures ?? {})) {
      const textureGuid = materialTextures.get(param);
      const sourcePath = textureGuid ? metaGuidIndex.get(textureGuid) : undefined;
      if (sourcePath && fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, path.join(outTextureDir, targetName));
        record.textures[param] = {
          file: targetName,
          resolved: true,
          importer: extractTextureImporterSettings(sourcePath),
        };
        summary.texturesCopied += 1;
        if (path.extname(sourcePath).toLowerCase() !== ".png") {
          problems.push(
            `${brush.name}: texture ${param} copied from non-png source ${path.basename(sourcePath)}`,
          );
        }
      } else {
        record.textures[param] = { file: targetName, resolved: false };
        summary.texturesMissing += 1;
        problems.push(`${brush.name} (${guid}): texture ${param} → ${targetName} unresolved`);
      }
    }

    assetsByGuid[guid] = record;
  }

  // Resolve m_Supersedes links: a superseded brush keeps rendering (old
  // sketches reference it) but is hidden from the picker, like in Open Brush.
  const brushGuidByAssetMetaGuid = new Map();
  for (const [brushGuid, descriptor] of descriptors) {
    if (descriptor.assetMetaGuid) {
      brushGuidByAssetMetaGuid.set(descriptor.assetMetaGuid, brushGuid);
    }
  }
  for (const [brushGuid, descriptor] of descriptors) {
    if (!descriptor.supersedesAssetGuid) {
      continue;
    }
    const supersededGuid = brushGuidByAssetMetaGuid.get(descriptor.supersedesAssetGuid);
    if (supersededGuid && assetsByGuid[supersededGuid]) {
      assetsByGuid[supersededGuid].supersededByGuid = brushGuid;
    }
  }

  await Promise.all(iconJobs.map((job) => writeTransparentIcon(job)));

  fs.copyFileSync(manifestPath, path.join(outGeneratedDir, "exportManifest.json"));
  fs.writeFileSync(
    path.join(outGeneratedDir, "brush-assets.json"),
    JSON.stringify({ summary, brushes: assetsByGuid }, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(outPublicDir, "NOTICE"),
    [
      "Brush shaders and textures in this directory are derived from Open Brush",
      "(https://github.com/icosa-foundation/open-brush), Copyright 2020 The Tilt",
      "Brush Authors / Open Brush contributors, licensed under the Apache License,",
      "Version 2.0 (http://www.apache.org/licenses/LICENSE-2.0).",
      "",
    ].join("\n"),
  );

  console.log("Brush asset extraction summary:");
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key}: ${value}`);
  }
  if (problems.length > 0) {
    console.log(`Problems (${problems.length}):`);
    for (const problem of problems) {
      console.log(`  - ${problem}`);
    }
  }
}

// The Unity button textures are white/colored glyphs rendered additively over
// solid black with no alpha channel (PanelButton_Atlas.shader draws the whole
// tile). Recover transparency by treating each pixel as premultiplied over
// black: alpha = max(r,g,b), color unpremultiplied.
async function writeTransparentIcon({ source, destination }) {
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    data[i + 3] = max;
    if (max > 0) {
      data[i] = Math.min(255, Math.round((data[i] * 255) / max));
      data[i + 1] = Math.min(255, Math.round((data[i + 1] * 255) / max));
      data[i + 2] = Math.min(255, Math.round((data[i + 2] * 255) / max));
    }
  }
  await sharp(data, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toFile(destination);
}

await main();
