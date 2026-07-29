export type BrushShaderCompatibilityContext =
  | "asset-load"
  | "browser"
  | "immersive-xr"
  | "visual";

export type BrushShaderCompatibilityStatus =
  | "ready"
  | "load-failed"
  | "compile-failed"
  | "visual-passed"
  | "visual-failed";

export interface BrushShaderCompatibilityRecord {
  guid: string;
  name: string;
  context: BrushShaderCompatibilityContext;
  status: BrushShaderCompatibilityStatus;
  checkedAt: string;
  userAgent: string;
  renderer?: string;
  message?: string;
}

interface CompatibilityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "brushspace.openBrushShaderCompatibility.v1";

export class BrushShaderCompatibilityRegistry {
  private readonly records = new Map<string, BrushShaderCompatibilityRecord>();

  constructor(private readonly storage = resolveStorage()) {
    this.restore();
  }

  record(
    value: Omit<BrushShaderCompatibilityRecord, "checkedAt" | "userAgent"> & {
      checkedAt?: string;
      userAgent?: string;
    },
  ): BrushShaderCompatibilityRecord {
    const record: BrushShaderCompatibilityRecord = {
      ...value,
      checkedAt: value.checkedAt ?? new Date().toISOString(),
      userAgent: value.userAgent ?? resolveUserAgent(),
    };
    this.records.set(createRecordKey(record), record);
    this.persist();
    return record;
  }

  get(
    guid: string,
    context: BrushShaderCompatibilityContext,
  ): BrushShaderCompatibilityRecord | undefined {
    return this.getAll()
      .filter(
        (record) =>
          record.context === context &&
          record.guid.toLowerCase() === guid.toLowerCase(),
      )
      .sort((left, right) => right.checkedAt.localeCompare(left.checkedAt))[0];
  }

  getAll(): BrushShaderCompatibilityRecord[] {
    return Array.from(this.records.values()).sort(
      (left, right) =>
        left.context.localeCompare(right.context) ||
        left.name.localeCompare(right.name) ||
        left.guid.localeCompare(right.guid),
    );
  }

  private restore(): void {
    if (!this.storage) {
      return;
    }
    try {
      const json = this.storage.getItem(STORAGE_KEY);
      const values = json ? (JSON.parse(json) as unknown) : undefined;
      if (!Array.isArray(values)) {
        return;
      }
      for (const value of values) {
        if (isCompatibilityRecord(value)) {
          this.records.set(createRecordKey(value), value);
        }
      }
    } catch {
      // Compatibility evidence must never prevent the painting runtime from
      // starting when storage is unavailable or contains stale data.
    }
  }

  private persist(): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.getAll()));
    } catch {
      // Private browsing and storage quotas can reject writes.
    }
  }
}

function createRecordKey(record: BrushShaderCompatibilityRecord): string {
  return [
    record.context,
    record.guid.toLowerCase(),
    record.userAgent,
    record.renderer ?? "",
  ].join(":");
}

function isCompatibilityRecord(value: unknown): value is BrushShaderCompatibilityRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<BrushShaderCompatibilityRecord>;
  return (
    typeof record.guid === "string" &&
    typeof record.name === "string" &&
    typeof record.checkedAt === "string" &&
    typeof record.userAgent === "string" &&
    (record.context === "asset-load" ||
      record.context === "browser" ||
      record.context === "immersive-xr" ||
      record.context === "visual") &&
    (record.status === "ready" ||
      record.status === "load-failed" ||
      record.status === "compile-failed" ||
      record.status === "visual-passed" ||
      record.status === "visual-failed")
  );
}

function resolveStorage(): CompatibilityStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function resolveUserAgent(): string {
  return typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
}

export const openBrushShaderCompatibility =
  new BrushShaderCompatibilityRegistry();
