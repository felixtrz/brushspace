import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const sourceRoot = join(root, "src");
const sources = new Map();

function walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      walk(path);
      continue;
    }

    if (path.endsWith(".ts")) {
      const relativePath = relative(root, path).replaceAll("\\", "/");
      sources.set(relativePath, readFileSync(path, "utf8"));
    }
  }
}

walk(sourceRoot);

const allSource = Array.from(sources.values()).join("\n");
const indexSource = sources.get("src/index.ts") ?? "";
const failures = [];

function sourceUsesAny(names) {
  return names.some((name) => new RegExp(`\\b${name}\\b`).test(allSource));
}

function indexHasFeatureEnabled(feature) {
  return new RegExp(`\\b${feature}\\s*:\\s*(?:true|\\{)`).test(indexSource);
}

if (
  sourceUsesAny(["OneHandGrabbable", "TwoHandsGrabbable", "DistanceGrabbable"]) &&
  !indexHasFeatureEnabled("grabbing")
) {
  failures.push("Grabbable components are used but World.create features.grabbing is not enabled.");
}

if (
  sourceUsesAny(["PhysicsBody", "PhysicsShape"]) &&
  !indexHasFeatureEnabled("physics")
) {
  failures.push("Physics components are used but World.create features.physics is not enabled.");
}

if (
  sourceUsesAny(["PanelUI", "ScreenSpace", "Follower"]) &&
  /spatialUI\s*:\s*false/.test(indexSource)
) {
  failures.push("Spatial UI components are used but World.create features.spatialUI is false.");
}

if (
  /\blocmotion\s*:\s*true\b/.test(indexSource) &&
  !sourceUsesAny(["LocomotionEnvironment", "PhysicsBody"])
) {
  failures.push("Locomotion is enabled but no LocomotionEnvironment or PhysicsBody setup was found.");
}

if (failures.length > 0) {
  console.error("IWSDK feature flag check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Feature flag check passed: IWSDK feature flags match current component usage.");
