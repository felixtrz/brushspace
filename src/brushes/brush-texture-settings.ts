import {
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  MirroredRepeatWrapping,
  NearestFilter,
  NearestMipmapNearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Texture,
} from "@iwsdk/core";

import type { BrushTextureImporterSettings } from "./brush-inventory.js";

export function resolveBrushTextureWrapping(
  mode: BrushTextureImporterSettings["wrapU"] | undefined,
) {
  switch (mode) {
    case "clamp":
      return ClampToEdgeWrapping;
    case "mirror":
    case "mirror-once":
      return MirroredRepeatWrapping;
    default:
      return RepeatWrapping;
  }
}

export function resolveBrushTextureMinFilter(
  filter: BrushTextureImporterSettings["filter"] | undefined,
  mipmaps: boolean,
) {
  if (!mipmaps) {
    return filter === "point" ? NearestFilter : LinearFilter;
  }
  switch (filter) {
    case "point":
      return NearestMipmapNearestFilter;
    case "trilinear":
      return LinearMipmapLinearFilter;
    default:
      return LinearMipmapNearestFilter;
  }
}

export function applyBrushTextureImporterSettings(
  texture: Texture,
  importer: BrushTextureImporterSettings | undefined,
): void {
  if (!importer) {
    return;
  }
  texture.colorSpace = importer.sRGB ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = resolveBrushTextureWrapping(importer.wrapU);
  texture.wrapT = resolveBrushTextureWrapping(importer.wrapV);
  texture.generateMipmaps = importer.mipmaps;
  texture.magFilter = importer.filter === "point" ? NearestFilter : LinearFilter;
  texture.minFilter = resolveBrushTextureMinFilter(
    importer.filter,
    importer.mipmaps,
  );
  texture.anisotropy = importer.anisotropy;
  texture.needsUpdate = true;
}

export function matchesBrushTextureImporterSettings(
  texture: Texture,
  importer: BrushTextureImporterSettings,
): boolean {
  return (
    texture.colorSpace === (importer.sRGB ? SRGBColorSpace : NoColorSpace) &&
    texture.wrapS === resolveBrushTextureWrapping(importer.wrapU) &&
    texture.wrapT === resolveBrushTextureWrapping(importer.wrapV) &&
    texture.generateMipmaps === importer.mipmaps &&
    texture.magFilter ===
      (importer.filter === "point" ? NearestFilter : LinearFilter) &&
    texture.minFilter ===
      resolveBrushTextureMinFilter(importer.filter, importer.mipmaps) &&
    texture.anisotropy === importer.anisotropy
  );
}
