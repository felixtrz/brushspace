import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "vendor/icosa-sketch-assets/brushes");
const target = resolve(root, "public/openbrush/icosa-brushes");

if (!existsSync(source)) {
  throw new Error(
    "icosa-sketch-assets is missing; initialize submodules with git submodule update --init",
  );
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
console.log("Mirrored pinned icosa-sketch-assets brush assets for self-hosting.");
