import { describe, expect, it, vi } from "vitest";

import {
  buildIcosaAssetsUrl,
  createDefaultSketchLister,
  createIcosaLister,
  downloadRemoteTiltBytes,
  fetchIcosaAssetsPage,
  parseIcosaAssetsPage,
} from "./icosa-gallery.js";

const ASSET_WITH_TILT = {
  assetId: "dIDpf7IS_5S",
  displayName: "Trainscape",
  authorName: "Tilt Brush",
  triangleCount: 374296,
  thumbnail: {
    relativePath: "thumbnail.png",
    url: "https://cdn.example/poly/dIDpf7IS_5S/thumbnail.png",
  },
  formats: [
    {
      formatType: "GLTF2",
      root: { url: "https://cdn.example/model.gltf" },
      isPreferredForDownload: true,
    },
    {
      // Non-CORS mirror listed first — must NOT be chosen over the B2 copy.
      formatType: "TILT",
      root: { url: "https://web.archive.org/sketch.tilt" },
      isCorsAllowed: false,
    },
    {
      formatType: "TILT",
      root: { url: "https://cdn.example/sketch.tilt" },
      isCorsAllowed: true,
    },
  ],
};

const ASSET_WITHOUT_TILT = {
  assetId: "no-tilt",
  displayName: "GLTF Only",
  formats: [{ formatType: "GLTF2", root: { url: "https://cdn.example/only.gltf" } }],
};

describe("buildIcosaAssetsUrl", () => {
  it("applies the curated-best-tilt default lister query", () => {
    const url = new URL(buildIcosaAssetsUrl());
    expect(url.origin + url.pathname).toBe("https://api.icosa.gallery/v1/assets");
    expect(url.searchParams.get("curated")).toBe("true");
    expect(url.searchParams.get("orderBy")).toBe("BEST");
    expect(url.searchParams.get("format")).toBe("TILT");
  });

  it("overrides defaults and adds pagination/category params", () => {
    const url = new URL(
      buildIcosaAssetsUrl({
        curated: false,
        orderBy: "NEWEST",
        category: "ANIMALS",
        pageSize: 24,
        pageToken: "abc",
      }),
    );
    expect(url.searchParams.get("curated")).toBe("false");
    expect(url.searchParams.get("orderBy")).toBe("NEWEST");
    expect(url.searchParams.get("category")).toBe("ANIMALS");
    expect(url.searchParams.get("pageSize")).toBe("24");
    expect(url.searchParams.get("pageToken")).toBe("abc");
  });
});

describe("parseIcosaAssetsPage", () => {
  it("maps assets to entries and prefers the CORS-enabled TILT url", () => {
    const page = parseIcosaAssetsPage({
      assets: [ASSET_WITH_TILT],
      totalSize: 1,
      nextPageToken: "next",
    });
    expect(page.entries).toEqual([
      {
        assetId: "dIDpf7IS_5S",
        name: "Trainscape",
        authorName: "Tilt Brush",
        thumbnailUrl: "https://cdn.example/poly/dIDpf7IS_5S/thumbnail.png",
        // The B2 (isCorsAllowed) copy wins over the archive.org mirror.
        tiltUrl: "https://cdn.example/sketch.tilt",
        triangleCount: 374296,
      },
    ]);
    expect(page.nextPageToken).toBe("next");
    expect(page.totalSize).toBe(1);
  });

  it("falls back to the only .tilt when none is flagged CORS-enabled", () => {
    const page = parseIcosaAssetsPage({
      assets: [
        {
          assetId: "mirror-only",
          displayName: "Mirror Only",
          formats: [
            {
              formatType: "TILT",
              root: { url: "https://web.archive.org/only.tilt" },
              isCorsAllowed: false,
            },
          ],
        },
      ],
    });
    expect(page.entries[0].tiltUrl).toBe("https://web.archive.org/only.tilt");
  });

  it("skips assets that have no downloadable .tilt", () => {
    const page = parseIcosaAssetsPage({
      assets: [ASSET_WITH_TILT, ASSET_WITHOUT_TILT],
    });
    expect(page.entries.map((entry) => entry.assetId)).toEqual(["dIDpf7IS_5S"]);
  });

  it("falls back to name/assetId and tolerates missing fields", () => {
    const page = parseIcosaAssetsPage({
      assets: [
        {
          assetId: "x1",
          name: "assets/x1",
          formats: [{ formatType: "TILT", root: { url: "https://cdn/x1.tilt" } }],
        },
      ],
    });
    expect(page.entries[0]).toMatchObject({
      assetId: "x1",
      name: "assets/x1",
      authorName: "",
      thumbnailUrl: "",
      triangleCount: 0,
    });
  });

  it("returns an empty page for malformed payloads", () => {
    expect(parseIcosaAssetsPage(null)).toEqual({
      entries: [],
      nextPageToken: undefined,
      totalSize: 0,
    });
    expect(parseIcosaAssetsPage({ assets: "nope" }).entries).toEqual([]);
  });

  it("ignores an empty-string nextPageToken", () => {
    const page = parseIcosaAssetsPage({ assets: [], nextPageToken: "" });
    expect(page.nextPageToken).toBeUndefined();
  });
});

describe("fetchIcosaAssetsPage", () => {
  it("requests the default lister URL and parses the response", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("orderBy=BEST");
      expect(url).toContain("curated=true");
      return new Response(
        JSON.stringify({ assets: [ASSET_WITH_TILT], totalSize: 1 }),
        { status: 200 },
      );
    });
    const page = await fetchIcosaAssetsPage({}, { fetch: fetchImpl as never });
    expect(page.entries).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    await expect(
      fetchIcosaAssetsPage({}, { fetch: fetchImpl as never }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("downloadRemoteTiltBytes", () => {
  it("routes the url through tiltProxy and returns bytes", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toBe("https://proxy/?https://cdn.example/sketch.tilt");
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    const bytes = await downloadRemoteTiltBytes("https://cdn.example/sketch.tilt", {
      fetch: fetchImpl as never,
      tiltProxy: (url) => `https://proxy/?${url}`,
    });
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    await expect(
      downloadRemoteTiltBytes("https://cdn.example/x.tilt", {
        fetch: fetchImpl as never,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("listers", () => {
  it("the default lister is curated + best", () => {
    const lister = createDefaultSketchLister();
    expect(lister.id).toBe("icosa:curated:BEST");
    expect(lister.label).toBe("Curated · Best");
  });

  it("a non-curated lister is labelled generically", () => {
    const lister = createIcosaLister({ curated: false, orderBy: "NEWEST" });
    expect(lister.label).toBe("Icosa Gallery");
  });

  it("forwards the page token to the request", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain("pageToken=cursor-2");
      return new Response(JSON.stringify({ assets: [] }), { status: 200 });
    });
    const lister = createDefaultSketchLister({ fetch: fetchImpl as never });
    await lister.listPage("cursor-2");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
