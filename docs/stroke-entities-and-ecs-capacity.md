# Stroke entities, the ECS capacity limit, and the fix

This documents why large `.tilt` sketches loaded as an empty scene, how the
fix works, the limitation that remains, and the architectural question behind
it: why brush strokes are ECS entities in this port when they are not in Open
Brush.

## The bug

Opening a stroke-heavy sketch (for example the curated Icosa sketch
"The Upside Down", 2804 strokes) produced an apparently empty scene, while
small sketches loaded fine.

The elics ECS underneath IWSDK preallocates every component's field storage as
fixed-size typed arrays sized `entityCapacity × fieldLength`, with
`entityCapacity` defaulting to **1000**. IWSDK's `World.create` constructs
`new World()` without exposing the option. Once the app's own entities
(player rig, panels, layers, …) are counted, spawning roughly the **951st**
stroke overflows a component's storage:

```
RangeError: offset is out of bounds
    at Float32Array.set
    at assignInitialComponentData
    at ComponentManager.attachComponent
```

The exception aborts the sketch spawn loop before the staggered reveal
transition runs, so the strokes that *did* spawn stay at their initial
`visible: false` — an empty scene. The same ceiling silently applied to
painting: ~950 hand-drawn strokes would hit the identical crash.

Open Brush has no such limit. `SketchMemoryScript` loads every stroke of a
`.tilt` as a live, editable stroke; the cap is purely an artifact of this
port's ECS substrate.

## The fix

`src/app/ecs-entity-capacity.ts` raises the capacity to **16384** before the
world is created (`raiseEcsEntityCapacity()` in `src/index.ts`, ahead of
`World.create`).

The mechanism is deliberate. Component storage **cannot be grown after the
fact**: IWSDK's zero-copy transform binding hands every `object3D` persistent
subarray views into `Transform`'s storage (`SyncedVector3` targets taken at
attach time), so swapping buffers later would strand the bindings of every
entity that already exists. Capacity must therefore be set before the first
component ever allocates storage. Since IWSDK hardcodes `new World()`, the
only seam is registration: every component registration funnels through
`World.prototype.registerComponent` → `componentManager.registerComponent`,
which sizes storage from `componentManager.entityCapacity` *at call time*.
The patch lifts that value on the way into the first registration, so every
component — `Transform` included — is sized at the raised capacity from the
start, with no migration and no stale views.

Verified against the running app (headless Chromium): before the fix,
"The Upside Down" crashed at stroke 950 with zero strokes visible; after it,
all 2804 strokes spawn, reveal, and draw.

## Why is each brush stroke an ECS entity?

It is a fair question — Open Brush does **not** do this.

**What Open Brush does.** A stroke is plain data (the `Stroke` class) owned by
`SketchMemoryScript`. Rendering goes through `BatchManager`: pooled batch
meshes, one per (canvas, brush material), each holding many strokes as vertex
ranges within a shared geometry. Erasing or selecting a stroke edits its
range inside the batch. Strokes only get individual GameObjects in special
cases. Draw calls scale with the number of *brush materials in use*, not the
number of strokes, and there is no per-stroke object ceiling.

**What this port does.** IWSDK is an ECS-first framework, and the port maps
each stroke to an entity carrying a `BrushStroke` component with its own
`Mesh`. What that buys, idiomatically:

- The eraser, selection, layer visibility, undo/redo, and the load/save
  reveal transitions are all expressed as queries over `BrushStroke`
  (`this.queries.strokes`), which is the intended IWSDK pattern (queries
  rather than hand-maintained arrays).
- Component fields live in typed arrays with zero-copy views
  (`getVectorView`) for hot-path reads like eraser bounds tests.
- Mesh lifecycle (parenting under the scene-pose canvas, disposal) rides the
  entity lifecycle that IWSDK already manages.

**What it costs.**

- A fixed entity budget — the bug documented above. Raised, not removed.
- One draw call per stroke. Open Brush renders a 2804-stroke sketch in a
  handful of draw calls; Brushspace issues 2804. This, not entity capacity,
  is the real scaling ceiling now, especially in-headset.
- Per-entity storage across ~40 registered components for every stroke.

**Assessment.** Per-stroke entities were the pragmatic mapping onto IWSDK's
idioms, and they keep every stroke individually editable with very little
bookkeeping code. But it is a genuine divergence from Open Brush's
architecture, and the ECS is doing a job (identity + a bag of per-stroke
fields) that a plain array of stroke records also does — the framework
benefits listed above are real but modest. The Open Brush design exists
precisely because per-stroke scene objects do not scale.

## Remaining limitations

- The capacity is a build-time constant (16384 slots shared by strokes and
  everything else). A pathological sketch beyond roughly 16k strokes would
  hit the same wall; raise `DEFAULT_ENTITY_CAPACITY` if that day comes, at
  a few hundred bytes of preallocated storage per slot.
- Draw calls still scale linearly with stroke count. Frame rate degrades on
  large sketches well before the entity budget is threatened again.

## Path to conformance

The conformant end-state is Open Brush's: strokes as plain data, rendering
through batched meshes keyed by brush material, with the in-progress stroke
authored individually and *committed into a batch* on finalize. Groundwork
already exists — `src/brushes/brush-batching.ts` (`planBrushBatches`) ports
Open Brush's batch grouping (layer × brush × material × variant) with tests,
but nothing renders through it yet. Under that design, entities would
represent batches (dozens), not strokes (thousands), and both limitations
above disappear together.
