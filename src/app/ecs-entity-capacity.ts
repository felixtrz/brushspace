/**
 * Raises the ECS entity capacity so stroke-heavy sketches load.
 *
 * Open Brush has no stroke limit — SketchMemoryScript loads every stroke of a
 * .tilt as a live, editable stroke (batching is purely a render concern). The
 * elics ECS underneath IWSDK, however, preallocates each component's storage
 * for a fixed `entityCapacity` that defaults to 1000, and IWSDK's
 * `World.create` constructs `new World()` without exposing the option. Once
 * the app's own entities are counted, spawning roughly the 951st stroke
 * overflows a component's storage (`RangeError: offset is out of bounds` from
 * `Float32Array.set`), which aborts the sketch load mid-spawn — a limit that
 * simply does not exist in Open Brush.
 *
 * Storage cannot be grown after the fact: IWSDK's zero-copy transform binding
 * hands every `object3D` persistent subarray views into `Transform`'s storage
 * (SyncedVector3 targets), so swapping buffers would strand every existing
 * binding. Capacity must therefore be raised before the first component is
 * registered. Every registration funnels through
 * `World.prototype.registerComponent` → `componentManager.registerComponent`,
 * which sizes storage from `componentManager.entityCapacity` at call time —
 * so bumping that value on the way into the first registration gives every
 * component (Transform included) the larger storage from the start, with no
 * migration. Call {@link raiseEcsEntityCapacity} before `World.create()`.
 */

import { World as EcsWorld } from "elics";

/**
 * Default capacity. "The Upside Down" (a typical large curated sketch) has
 * 2804 strokes; this leaves ~5x headroom over that plus the app's own
 * entities. Component storage is a few hundred bytes per entity slot across
 * all registered components (a few MB total) — small next to the stroke
 * meshes themselves. Per-stroke draw calls make far larger sketches a
 * performance problem before this becomes the limit again.
 */
export const DEFAULT_ENTITY_CAPACITY = 16384;

interface PatchableWorld {
  componentManager: { entityCapacity: number };
}

const PATCH_FLAG = "__brushspaceEntityCapacity";

type PatchedPrototype = {
  registerComponent: (typeof EcsWorld.prototype)["registerComponent"];
  [PATCH_FLAG]?: number;
};

/**
 * Ensures every elics world registers its components with at least `capacity`
 * entity slots. Idempotent; repeated calls keep the largest capacity asked
 * for. Must run before `World.create()` so no storage is allocated at the
 * default size.
 */
export function raiseEcsEntityCapacity(
  capacity: number = DEFAULT_ENTITY_CAPACITY,
): void {
  const prototype = EcsWorld.prototype as unknown as PatchedPrototype;
  const patchedTo = prototype[PATCH_FLAG];
  if (patchedTo !== undefined) {
    prototype[PATCH_FLAG] = Math.max(patchedTo, capacity);
    return;
  }
  prototype[PATCH_FLAG] = capacity;
  const originalRegisterComponent = prototype.registerComponent;
  prototype.registerComponent = function patchedRegisterComponent(
    this: PatchableWorld,
    component,
  ) {
    const raised = (prototype[PATCH_FLAG] ?? DEFAULT_ENTITY_CAPACITY) as number;
    if (this.componentManager.entityCapacity < raised) {
      this.componentManager.entityCapacity = raised;
    }
    return originalRegisterComponent.call(
      this as unknown as InstanceType<typeof EcsWorld>,
      component,
    );
  } as (typeof EcsWorld.prototype)["registerComponent"];
}
