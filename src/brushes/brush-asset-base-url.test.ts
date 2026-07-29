import { describe, expect, it } from "vitest";

import {
  ICOSA_SKETCH_ASSETS_REVISION,
  PINNED_ICOSA_BRUSH_ASSET_BASE_URL,
  resolveBrushAssetBaseUrl,
} from "./brush-asset-base-url.js";

describe("resolveBrushAssetBaseUrl", () => {
  it("defaults to the immutable approved dependency revision", () => {
    expect(resolveBrushAssetBaseUrl({ MODE: "production" })).toBe(
      PINNED_ICOSA_BRUSH_ASSET_BASE_URL,
    );
    expect(PINNED_ICOSA_BRUSH_ASSET_BASE_URL).toContain(
      `@${ICOSA_SKETCH_ASSETS_REVISION}/brushes/`,
    );
  });

  it("accepts a configured hosted or mirrored base URL", () => {
    expect(
      resolveBrushAssetBaseUrl({
        VITE_ICOSA_BRUSH_ASSET_BASE_URL: "https://assets.example/brushes",
      }),
    ).toBe("https://assets.example/brushes/");
  });

  it("uses the deploy-relative mirror for mirror modes", () => {
    expect(resolveBrushAssetBaseUrl({ MODE: "mirror-http" })).toMatch(
      /\/openbrush\/icosa-brushes\/$/,
    );
  });
});
