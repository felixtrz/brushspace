import { describe, expect, it } from "vitest";

import { BrushShaderCompatibilityRegistry } from "./brush-shader-compatibility.js";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("Open Brush shader compatibility registry", () => {
  it("persists one current result per brush and context", () => {
    const storage = new MemoryStorage();
    const registry = new BrushShaderCompatibilityRegistry(storage);
    registry.record({
      guid: "ABC",
      name: "Brush",
      context: "browser",
      status: "compile-failed",
      message: "link failed",
      checkedAt: "2026-01-01T00:00:00.000Z",
      userAgent: "test-browser",
    });
    registry.record({
      guid: "abc",
      name: "Brush",
      context: "browser",
      status: "ready",
      checkedAt: "2026-01-02T00:00:00.000Z",
      userAgent: "test-browser",
    });
    registry.record({
      guid: "abc",
      name: "Brush",
      context: "immersive-xr",
      status: "ready",
      checkedAt: "2026-01-02T00:00:00.000Z",
      userAgent: "test-browser",
    });

    const restored = new BrushShaderCompatibilityRegistry(storage);
    expect(restored.getAll()).toHaveLength(2);
    expect(restored.get("ABC", "browser")).toMatchObject({
      status: "ready",
      checkedAt: "2026-01-02T00:00:00.000Z",
    });
    expect(restored.get("abc", "immersive-xr")?.status).toBe("ready");
  });

  it("ignores malformed persisted evidence", () => {
    const storage = new MemoryStorage();
    storage.setItem("brushspace.openBrushShaderCompatibility.v1", "[null,{}]");

    expect(new BrushShaderCompatibilityRegistry(storage).getAll()).toEqual([]);
  });
});
