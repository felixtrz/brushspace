/**
 * Icosa Gallery integration.
 *
 * Lists sketches from the public Icosa Gallery API
 * (https://api.icosa.gallery/v1) and downloads their `.tilt` files so they can
 * be opened in Brushspace. The default lister returns curated sketches ordered
 * by "best".
 *
 * CORS notes for the browser:
 * - The `/v1/assets` listing endpoint and the thumbnail hosts both send
 *   permissive `Access-Control-Allow-Origin` headers, so they can be read
 *   directly from any origin.
 * - Most assets ship the `.tilt` twice: a CORS-enabled copy on Backblaze B2
 *   and a mirror on web.archive.org that sends no CORS headers. We prefer the
 *   B2 copy (see `selectTiltUrl`) so the browser can download it directly. For
 *   the rare asset that only has the non-CORS mirror, pass a `tiltProxy` to
 *   route the download through a same-origin or CORS-enabled proxy. In Node
 *   (tests, tooling) either copy downloads directly.
 */

import type { SketchDocument } from "./document.js";
import { readTiltFile } from "./tilt-file.js";

export const ICOSA_API_BASE = "https://api.icosa.gallery/v1";

/** Ordering accepted by the `orderBy` query parameter (subset we surface). */
export type IcosaOrderBy =
  | "BEST"
  | "NEWEST"
  | "OLDEST"
  | "LIKES"
  | "DOWNLOADS"
  | "TRIANGLE_COUNT";

export interface IcosaAssetsQuery {
  /** Restrict to curated assets. */
  curated?: boolean;
  /** Result ordering. */
  orderBy?: IcosaOrderBy;
  /** Format filter — defaults to `TILT` so every result has a `.tilt`. */
  format?: string;
  /** Optional category filter (e.g. `ANIMALS`, `ART`). */
  category?: string;
  /** Free-text keyword search. */
  keywords?: string;
  /** Opaque pagination cursor from a previous page's `nextPageToken`. */
  pageToken?: string;
  /** Results per page. */
  pageSize?: number;
}

/**
 * The default lister query: curated sketches ordered by "best", limited to
 * assets that ship a `.tilt` format.
 */
export const DEFAULT_ICOSA_QUERY: Readonly<IcosaAssetsQuery> = {
  curated: true,
  orderBy: "BEST",
  format: "TILT",
};

/** A single Icosa asset reduced to what the gallery needs. */
export interface RemoteSketchEntry {
  assetId: string;
  name: string;
  authorName: string;
  thumbnailUrl: string;
  /** Download URL for the asset's `.tilt` format. */
  tiltUrl: string;
  triangleCount: number;
}

export interface RemoteSketchPage {
  entries: RemoteSketchEntry[];
  nextPageToken?: string;
  totalSize: number;
}

export interface IcosaFetchOptions {
  /** Injected fetch implementation (defaults to the global `fetch`). */
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /**
   * Rewrites a `.tilt` download URL before it is fetched — e.g. to prepend a
   * same-origin CORS proxy. Defaults to the identity transform.
   */
  tiltProxy?: (url: string) => string;
}

/** Builds the `/v1/assets` request URL, applying the default lister query. */
export function buildIcosaAssetsUrl(
  query: IcosaAssetsQuery = {},
  base: string = ICOSA_API_BASE,
): string {
  const merged = { ...DEFAULT_ICOSA_QUERY, ...query };
  const url = new URL(`${base.replace(/\/$/, "")}/assets`);
  const params = url.searchParams;
  if (merged.curated !== undefined) {
    params.set("curated", String(merged.curated));
  }
  if (merged.orderBy) {
    params.set("orderBy", merged.orderBy);
  }
  if (merged.format) {
    params.set("format", merged.format);
  }
  if (merged.category) {
    params.set("category", merged.category);
  }
  if (merged.keywords) {
    params.set("keywords", merged.keywords);
  }
  if (merged.pageToken) {
    params.set("pageToken", merged.pageToken);
  }
  if (merged.pageSize !== undefined) {
    params.set("pageSize", String(merged.pageSize));
  }
  return url.toString();
}

/**
 * Parses a `PagedAssetSchema` response into gallery entries. Assets without a
 * downloadable `.tilt` format are skipped so the gallery never lists a sketch
 * it cannot open.
 */
export function parseIcosaAssetsPage(payload: unknown): RemoteSketchPage {
  const root = asRecord(payload);
  const rawAssets = Array.isArray(root.assets) ? root.assets : [];
  const entries: RemoteSketchEntry[] = [];
  for (const raw of rawAssets) {
    const entry = parseAsset(raw);
    if (entry) {
      entries.push(entry);
    }
  }
  const nextPageToken =
    typeof root.nextPageToken === "string" && root.nextPageToken.length > 0
      ? root.nextPageToken
      : undefined;
  const totalSize =
    typeof root.totalSize === "number" ? root.totalSize : entries.length;
  return { entries, nextPageToken, totalSize };
}

/** Fetches and parses one page of assets, applying the default lister query. */
export async function fetchIcosaAssetsPage(
  query: IcosaAssetsQuery = {},
  options: IcosaFetchOptions = {},
): Promise<RemoteSketchPage> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const response = await fetchImpl(buildIcosaAssetsUrl(query), {
    signal: options.signal,
  });
  if (!response.ok) {
    throw new Error(`Icosa Gallery request failed: HTTP ${response.status}`);
  }
  return parseIcosaAssetsPage(await response.json());
}

/** Downloads the raw bytes of a `.tilt` file, applying any `tiltProxy`. */
export async function downloadRemoteTiltBytes(
  url: string,
  options: IcosaFetchOptions = {},
): Promise<Uint8Array> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const target = options.tiltProxy ? options.tiltProxy(url) : url;
  const response = await fetchImpl(target, { signal: options.signal });
  if (!response.ok) {
    throw new Error(`Failed to download .tilt: HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** Downloads a `.tilt` file and decodes it into a sketch document. */
export async function downloadRemoteTiltDocument(
  url: string,
  options: IcosaFetchOptions = {},
): Promise<SketchDocument> {
  return readTiltFile(await downloadRemoteTiltBytes(url, options));
}

/** A named source of remote sketches, paged. */
export interface SketchLister {
  readonly id: string;
  readonly label: string;
  listPage(pageToken?: string): Promise<RemoteSketchPage>;
}

/** Creates a lister backed by the Icosa Gallery `/v1/assets` endpoint. */
export function createIcosaLister(
  query: IcosaAssetsQuery = {},
  options: IcosaFetchOptions = {},
): SketchLister {
  const base = { ...DEFAULT_ICOSA_QUERY, ...query };
  const curatedBest = base.curated === true && base.orderBy === "BEST";
  return {
    id: `icosa:${base.curated ? "curated" : "all"}:${base.orderBy ?? "BEST"}`,
    label: curatedBest ? "Curated · Best" : "Icosa Gallery",
    listPage: (pageToken) => fetchIcosaAssetsPage({ ...base, pageToken }, options),
  };
}

/** The default lister: curated Icosa sketches ordered by "best". */
export function createDefaultSketchLister(
  options: IcosaFetchOptions = {},
): SketchLister {
  return createIcosaLister(DEFAULT_ICOSA_QUERY, options);
}

function parseAsset(raw: unknown): RemoteSketchEntry | undefined {
  const asset = asRecord(raw);
  const assetId = typeof asset.assetId === "string" ? asset.assetId : "";
  if (!assetId) {
    return undefined;
  }
  const tiltUrl = selectTiltUrl(asset.formats);
  if (!tiltUrl) {
    return undefined;
  }
  const displayName =
    typeof asset.displayName === "string" && asset.displayName.length > 0
      ? asset.displayName
      : typeof asset.name === "string" && asset.name.length > 0
        ? asset.name
        : assetId;
  return {
    assetId,
    name: displayName,
    authorName: typeof asset.authorName === "string" ? asset.authorName : "",
    thumbnailUrl: selectThumbnailUrl(asset.thumbnail),
    tiltUrl,
    triangleCount:
      typeof asset.triangleCount === "number" ? asset.triangleCount : 0,
  };
}

function selectTiltUrl(formats: unknown): string | undefined {
  if (!Array.isArray(formats)) {
    return undefined;
  }
  // Most assets carry the .tilt twice: a CORS-enabled copy on Backblaze B2 and
  // a mirror on web.archive.org that sends no CORS headers. Prefer the former
  // (isCorsAllowed) so the browser can download it directly; fall back to any
  // .tilt url for the rare asset that only has the mirror.
  let fallback: string | undefined;
  for (const format of formats) {
    const record = asRecord(format);
    if (record.formatType !== "TILT") {
      continue;
    }
    const root = asRecord(record.root);
    const url =
      typeof root.url === "string" && root.url.length > 0 ? root.url : undefined;
    if (!url) {
      continue;
    }
    if (record.isCorsAllowed === true) {
      return url;
    }
    fallback ??= url;
  }
  return fallback;
}

function selectThumbnailUrl(thumbnail: unknown): string {
  const record = asRecord(thumbnail);
  return typeof record.url === "string" ? record.url : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
