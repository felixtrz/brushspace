import type { Texture } from "@iwsdk/core";
import { describe, expect, it, vi } from "vitest";

import {
  applyBrushTextureImporterSettings,
  matchesBrushTextureImporterSettings,
} from "./brush-texture-settings.js";

vi.mock("@iwsdk/core", () => ({
  ClampToEdgeWrapping: "clamp",
  LinearFilter: "linear",
  LinearMipmapLinearFilter: "linear-mipmap-linear",
  LinearMipmapNearestFilter: "linear-mipmap-nearest",
  MirroredRepeatWrapping: "mirror",
  NearestFilter: "nearest",
  NearestMipmapNearestFilter: "nearest-mipmap-nearest",
  NoColorSpace: "linear-color",
  RepeatWrapping: "repeat",
  SRGBColorSpace: "srgb",
}));

describe("authoritative brush texture settings", () => {
  it("reapplies Oil Paint's Unity main-texture importer settings", () => {
    const texture = {} as Texture;

    const importer = {
      sRGB: true,
      mipmaps: true,
      filter: "bilinear" as const,
      wrapU: "clamp" as const,
      wrapV: "clamp" as const,
      anisotropy: 4,
      mipBias: 0,
    };

    applyBrushTextureImporterSettings(texture, importer);

    expect(texture.colorSpace).toBe("srgb");
    expect(texture.wrapS).toBe("clamp");
    expect(texture.wrapT).toBe("clamp");
    expect(texture.generateMipmaps).toBe(true);
    expect(texture.magFilter).toBe("linear");
    expect(texture.minFilter).toBe("linear-mipmap-nearest");
    expect(texture.anisotropy).toBe(4);
    expect(matchesBrushTextureImporterSettings(texture, importer)).toBe(true);
  });

  it("does not mutate textures without importer metadata", () => {
    const texture = { wrapS: "repeat", wrapT: "repeat" } as unknown as Texture;

    applyBrushTextureImporterSettings(texture, undefined);

    expect(texture.wrapS).toBe("repeat");
    expect(texture.wrapT).toBe("repeat");
  });
});
