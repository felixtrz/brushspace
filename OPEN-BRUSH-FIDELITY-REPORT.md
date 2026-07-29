# Open Brush brush fidelity review

Date: 2026-07-11

Brushspace: `295a8ba`

Open Brush: [`4786d55ad398bfc957d8e8eb26438920026aeaf6`](https://github.com/icosa-foundation/open-brush/tree/4786d55ad398bfc957d8e8eb26438920026aeaf6)

## Executive assessment

Brushspace is a functional WebXR painting application derived from Open Brush concepts and assets. It is not currently a faithful port of Open Brush's brush runtime.

The strongest mapping is the data layer: all 123 extracted GUIDs are present, shader and texture assets have been extracted, and the main `.tilt` stroke fields are represented. The required fidelity target matches Open Brush's authored picker catalogs: 48 standard brushes plus 47 experimental brushes. Four additional experimental entries are tagged `broken`, and 24 uncatalogued compatibility records remain loadable for old sketches but are not port requirements. Ribbon, tube, thick-strip, convex/concave-hull, and all three particle-generator families now have dedicated geometry paths, but mesh generation remains the largest gap for stamp, special, and several custom-deformation brushes. Export shaders cannot restore topology, smoothing, or brush-specific silhouette behavior that was never generated.

Catalog scope and runtime visibility are independent of fidelity classification:

| Set | Count | Actual meaning |
| --- | ---: | --- |
| Standard catalog | 48 | Shown in manifest order, 12 per page |
| Experimental catalog | 47 | The 51 extracted experimental records minus four entries tagged `broken` |
| Required total | 95 | The only brushes required for fidelity work |
| Compatibility/non-catalog | 24 | Retained for old sketches, excluded from the port backlog |
| Broken experimental | 4 | CandyCane, HolidayTree, Snowflake, and Braid3; excluded by Open Brush's tag filter |

All 95 required buttons are visible. Brushes classified as **Likely mostly
correct** remain selectable; brushes classified as **Unverified or likely
substantially wrong** are visibly marked and disabled rather than silently routed
through generic fallback rendering. All 95 required catalog entries now have an
implemented mesh/material contract and are enabled; the disabled distinction
continues to apply to unsupported compatibility-only records.

The 123 asset records contain 74 handcrafted and 49 template shaders, and report 112 resolved texture bindings with none missing. Those are asset-pipeline coverage figures, not fidelity figures.

Estimated current fidelity:

- Catalog and static assets: high, about 90%+.
- Ordinary `.tilt` stroke fields: moderate to high, about 65-80%.
- Live mesh generation across the catalog: moderate, about 45-60%.
- Materials: moderate across supported ribbon, tube, and particle families; low for Unity-only effects.
- Overall Open Brush product parity: about 20-30%.

These are engineering estimates, not conformance scores. Brushspace is best described as a purpose-built web reimplementation with partial asset and format compatibility.

## What maps well

1. Brush GUIDs, manifest values, shader parameters, textures, descriptor tags, pressure ranges, and several geometry settings are data-driven.
2. All 95 required brushes currently resolve materials through pinned `icosa-sketch-assets` and `three-icosa` revisions, and `three-tiltloader` supplies the reusable mesh generators. The current Brushspace pins use the reviewed dependency revisions described below; quarantined integration branches are excluded. The intended local material adapter is limited to IWSDK-compatible material construction, frame uniforms, diagnostics, and compatibility-only fallbacks.
3. Color, brush GUID, size, scale, flags, seed, group, layer, pose, pressure, and timestamp are represented.
4. Authoring includes keeper/trailing-point sampling and a pressure-dependent spawn interval.
5. Non-raw `ShaderMaterial` is a sensible WebXR adaptation because it permits super-three's GLSL3 and multiview rewriting.
6. Generated production assets do not require a Unity checkout at runtime.

## Mesh-generation gaps

### Generator coverage

Open Brush has 32 C# files under `Assets/Scripts/Brushes`. Brushspace currently maps:

- Four quad-strip/flat classes to one `ribbon` generator.
- `TubeBrush` and several derived contracts to a parameterized `tube` generator.
- Three particle classes to dedicated deterministic particle generators.
- `SquareBrush` to a hard-edged rectangular-prism specialization of the tube builder.
- `ThickGeometryBrush` to its six-vertex belly-strip topology.
- `HullBrush` to tetrahedron inputs followed by convex-hull generation, with
  source faceted and angle-weighted smooth-normal output modes.
- `ConcaveHullBrush` to overlapping five-knot hulls built from its
  pressure-sized, controller-oriented quill segments.
- `Square3DPrintBrush` to capped manifold rounded-square rings with its source
  bevel, cap fan, orientation validity, and section-break rules.
- Everything else to unsupported or unmapped.

No required catalog generator remains unmapped. SquarePaper now emits SquareBrush's four hard-edged sides, 0.375 cross-section aspect, caps, and constant center UVs. ThickGeometry now emits the source six-vertex ring, eight-triangle segment, endpoint belly pinch, distance UV, normals, tangents, and GeometryBrush pressure smoothing. ShinyHull, MatteHull, UnlitHull, DiamondHull, and SmoothHull now use the source tetrahedron knot conversion, convex envelope, 3D UV contract, and faceted/smooth vertex modes. ConcaveHull uses the source five-knot sliding window and QuillPen conversion. 3D Printing Brush emits capped, manifold eight-vertex rounded-square rings with independently smoothed start/end sizes and source-smoothed knot centers. Compatibility-only blocks, holiday, braid, SVG, PBR/environment, and other special generators are retained for old sketches but are outside the 95-brush target.

### Knot and sampling semantics

Open Brush generators consume knots containing raw and smoothed pose/pressure,
frame state, length, breaks, geometry ranges, and deterministic RNG state. Live
web authoring now uses descriptor solid-minimum length, pressured-size spacing,
minimum motion, and the source distance-smoothed pressure (including the shorter
M11 window) when deciding whether to extend or keep a trailing point. Spray and
Genius particle constructors explicitly disable that smoothing and retain raw
pressure. Live keeper spacing dispatches the authored formulas for
ribbon/tube/flat/thick, Spray/Midpoint Spray, Genius particles, 3D Print, and
convex/concave hull generators. QuadStrip retains its 1.5 mm solid minimum;
Flat/Thick/Printable/Square use 2 mm and Tube/hulls consume their descriptor
value. Finalized generators also reconstruct the pressure and position
smoothing documented below.
Remaining cross-generator gaps are adjacent-knot rebuild/restart behavior,
generator-specific finalization beyond empty-geometry discard, and vertex-limit
splitting. Local strokes with no generated triangles are discarded before
history, mirroring Open Brush's no-used-geometry rule while retaining valid
single-particle strokes.

Serialized `brushScale` is now applied to local ribbon width, tube radius and
modifiers, particle size, bounds, and distance-UV density. This matches Open
Brush's `brushSize * brushScale` conversion from pointer to canvas space.

### Ribbons

Dependency recovery note: shader-side fidelity changes described in the generator
sections below were implemented on quarantined `icosa-sketch-assets` and
`three-icosa` integration branches. They remain useful diagnostic evidence, but
they are not accepted upstream progress and must not be retained by modifying the
verified shader corpus. Re-establish each result by correcting generated vertex
data, bindings, uniforms, render state, or Brushspace render composition against
the trusted dependencies. Geometry work in `three-tiltloader` remains the primary
reusable implementation path.

The local ribbon now distinguishes distance, stretch, and unitized UV modes; uses
physical length and tile rate where required; selects atlas rows deterministically;
emits explicit hue-shifted backfaces; and supplies normals and tangents. Generated
Unity UVs are converted to the glTF convention consumed by the exported shaders.
Sub-millimetre moves and direction reversals now split the indexed strip, with
distance/stretch UVs restarted per section. Important remaining differences are:

- FlatGeometry brushes now honor their extracted distance/stretch UV style;
  DuctTapeGeometry no longer falls through to stretch UVs.
- FlatGeometry tangents now come from the source triangle/UV gradient rule
  rather than the stroke direction, restoring the intended tangent basis for
  normal-mapped flat brushes at bends.
- Ribbon pressure now uses Open Brush's distance-based smoothing window,
  including the shorter M11 FlatGeometry window and its forced zero-pressure
  initial knot in both finalized geometry and live keeper state.
- Non-M11 FlatGeometry's second pass now smooths each section's final rendered
  center toward the following non-rendered break knot, while retaining the
  unsmoothed terminal width used by Unity.
- Remaining position/frame differences, discard, and adjacent-knot rebuild
  rules are incomplete. Non-M11 `FlatGeometryBrush` strokes clip
  self-intersections and cap width growth against raw knot travel before the
  source second-pass edge smoothing. On finalization they also trim rendered
  geometry after a late break when fewer than six knots remain, while retaining
  the serialized control points as Unity does.
- Distance, stretch, and unitized QuadStrip brushes now emit Open Brush's
  explicit six-vertex triangle-soup solids, including separate backface solids.
  Solids use the source segment-centered `PositionQuad` frame, uniform current
  smoothed-pressure width, color interpolation, and vector-offset contract.
  DistanceUV variants apply the source byte-quantized 25 mm beginning/leading
  opacity ramp after fused solid lengths are known. Their U progression replays
  the source newest-three-solid updates using each append's pressured width and
  current averaged edge lengths.
  StretchUV sections normalize U from those final averaged left/right solid
  lengths before rebuilding tangent space.
  Finalized geometry also reconstructs the source backward midpoint/fusion pass,
  fused-edge normals, and triangle-derived tangent space. Provisional leading
  edges and incremental late-knot replacement remain incomplete.
- QuadStrip sharp bends now carry the source edge-crossing size adjustment,
  projected forward vector, `m_LastSizeShrink` state, and distance recovery
  into subsequent solids.
- Finalized local and collaboration QuadStrip strokes now apply the source
  `GetNumUsedVerts` cleanup using the retained keeper/trailing-point state;
  live provisional tips and keeper-only imported strokes remain visible.
  Broader head/tail simplification for other generators remains incomplete.
- DoubleTapered and Electricity now consume the emitted edge-vector layout.
  Electricity also recreates the Unity shader's three displacement passes;
  exact `FlatGeometryBrush` smoothing/topology remains open.
- SingleSided and DoubleFlat now use the Unity diffuse-texture cutout path in the
  approved maintained shaders. Browser smoke verifies that both loaded fragments
  retain the texture sample, vertex-alpha cutoff, and discard contract.
- Space still uses the maintained web shader's three-octave value-noise
  substitute. The Unity 2D/3D simplex-noise basis and six-octave
  `0.516`-persistence FBM remain an upstream asset gap.
- Toon now recreates its radius-packed, front-culled black outline pass. Its
  blue surface remains too narrow against the Unity reference, so exact tube
  radius/topology is still required.
- TubeToonInverted now opts into its Unity black base and inverse-scale inflated
  color passes, including object-space normal-y shading. The maintained shader's
  default pass value preserves its former one-pass output for consumers that do
  not request the new passes.

### Tubes

The parallel-transport tube now consumes extracted side count, end-cap, hard-edge,
UV-style, cap-aspect, atlas, radius-packing, taper, and petal settings. It carries
Open Brush's distance-based pressure smoothing into radius, opacity, and petal
displacement, uses
circumference-dependent distance UVs, emits tangents, and splits/caps sections
using Open Brush's minimum-motion and width-relative frame-angle tests. Remaining
differences are:

- Cap/ring topology has not been byte-compared against each upstream `TubeBrush` variant.
- `SquareBrush` now uses its source flat rectangular start/end faces and 16
  duplicated corner vertices per solid instead of inheriting pointed TubeBrush
  cap tips that extended the stroke bounds. Its rings also remain on raw
  control-point positions rather than inheriting TubeBrush center smoothing,
  and use `ComputeSurfaceFrameNew` with the current knot's pointer orientation.
  Breaks depend on raw movement angle and pressured size, so pointer roll alone
  does not split a straight solid.
- Hard-edged tube rings now use Open Brush's radial tangent channel instead of
  the stroke-forward tangent, restoring the authored tangent basis for their
  normal maps.
- A break-delimited Tube section now rebuilds its retained back ring from the
  following valid knot's frame, matching the source rather than retaining the
  broken incoming segment's orientation.
- Distance-UV Tube sections now restart their deterministic atlas row at each
  break, and each end cap inherits the V range of its own ring.
- Finalized Tube knot centers use the source three-point smoothing filter;
  incremental adjacent-knot rebuild semantics remain absent.
- Sin, comet, taper, petal, and double-taper modifier progress now restarts for
  each break-delimited Tube section, as does StretchUV knot progression.
  StretchUV reproduces the source overwrite pass: its final two rings share
  `(N - 1) / N`, and cap U values retain the documented Unity limitation.
  Double-taper also applies the source trailing-knot partial-progress
  interpolation and short-stroke attenuation against the Tube spawn interval.
  Exact modifier curves still need Unity mesh-dump validation.
- Disco and LightWire consume the radius-packed 3D UV0 tube contract; exact Unity deformation still needs fixture comparison.
- Rain now uses Unity's 2.25-radius strip separation and exact `_Time.y * 4`
  scroll/randomization rates instead of the maintained web shader's reduced
  bulge and 30%-speed compensation.
- Culling and seam behavior need per-brush visual validation.

### Particles

The seven `GeniusParticlesBrush` entries now create deterministic finalized
particles at the source `0.0025 / particleRate` distance interval. Placement
uses the source salt layout, pressure sizing/floor, size variance, spherical
spread, random orientation/alpha, and atlas selection. Their GeometryBrush
constructor disables pressure smoothing, so size and opacity use raw knot
pressure. They pack center,
rotation, birth time, source position, and vertex ID into the Open Brush
normal/UV contract and render through their handcrafted export shaders, which
restore camera billboarding and texture animation. A browser pixel gate renders
generated Smoke geometry through that shader and rejects empty or black output.
Live Genius strokes keep points at the source `0.0025 / particleRate` interval
and add the source pointer-hanging particle, which finalization removes before
the stroke becomes persistent. Finalized two-knot strokes rebuild only their
last particle with Unity's minimum 0.8 trigger pressure, including segments
that spawned multiple particles. Preview birth times use the source negative-time
encoding, and six maintained Genius shaders now shrink those particles with the
source quadratic curve over the shared 0.2-second preview lifetime. Rising
Bubbles now ports its Unity vertex behavior: exponential origin spread,
rising/jitter displacement, lifetime dimming, rotated camera billboarding, and
the same preview shrink contract. Bubbles, Snow, and Stars now move from the
packed source position to their randomized center using Unity's exponential
spread curve. Dots and Smoke intentionally retain their Unity shaders'
non-spreading `ParticleVertex_t` paths. Bubbles, Embers, and Snow ramp their
animated displacement by the same spread progress; Embers' packed origin and
center coincide, but its separate scrolling displacement still ramps in. Smoke
now uses the Unity shader's curl-only motion with the source spatial frequency,
time rate, and displacement scale instead of the former web-specific jitter.

The seven `SprayBrush` entries now spawn segment-oriented quads at the source
pressure-sized interval, including the 500-quad segment cap, source salt
layout, size/position/rotation/alpha variance, size ratio, atlas selection,
raw knot pressure, explicit backfaces, and real default-vertex export shaders.
A Splatter pixel
gate rejects empty or black generated output. Preview decay remains
approximate, although preview control points now use the same pressure-sized
keeper interval and trailing-point extension as persistent strokes. They use
Open Brush's shared 0.2-second lifetime and preserve the source decayed-knot
salt offset as expired knots are removed. Genius particles also retain the
removed distance modulo their spawn interval, matching the source length-cache phase.
Live Spray and Midpoint Spray strokes use `pressuredSize / sprayRateMultiplier`
instead of the ribbon/tube keeper formula.

The three `MidpointPlusLifetimeSprayBrush` entries now use the same authored
distance spawning and segment frame, plus their distinct five-quad salt layout
and 4D UV1 corner-offset/birth-time contract. Midpoint preview rebuilds restart
that salt layout from the rebuilt knot indices rather than carrying the
decayed-knot offset used by Spray and Genius. Unlike Spray and Genius, Midpoint
retains GeometryBrush's distance-smoothed pressure for live keeper spacing,
spawn count, size, and opacity. DanceFloor now exposes the generated UV1 birth
time through the scalar `a_timestamp` binding used by its maintained shader,
restoring its lifetime color/normal pulse input.
WaveformParticles retains its birth-time-driven curl displacement.
HyperGrid now reproduces
Unity's lifetime-dependent transition from its fine birth grid to its
particle-size grid; its additional audio-reactive behavior remains absent. Finalized loaded
Midpoint and Genius particle strokes now use Open Brush's deterministic zero
birth time, while live-authored strokes retain timestamps in the same
level-relative time domain supplied to shader `u_time`. Preview decay uses that
same origin through its accumulated frame deltas. Imported sketches therefore
retain Open Brush's zero-birth animation policy without inheriting an arbitrary
browser/system clock offset. A remote live stroke keeps its peer-relative
particle timing but receives one fixed offset when first observed, aligning its
newest birth to the receiver's level clock without sliding phase on later
progress updates.

### Performance

Finalized strokes remain separate meshes and draw calls, and frustum culling is
disabled. Active geometry now uploads only its used vertex and index ranges
rather than each geometrically grown buffer's full capacity. `brush-batching.ts`
has tests but no production caller. Large Open Brush sketches still need pooled
material batches, separate dynamic active-stroke buffers, deformation-aware
culling bounds, and erase/undo compaction.

## Shared dependency architecture

Brushspace should not own private copies of reusable Open Brush parsing, geometry, shader assets, or material bindings. The intended source-of-truth split is:

- [`three-tiltloader`](https://github.com/icosa-foundation/three-tiltloader) owns `.tilt` archive/binary parsing, the stroke and control-point data model, brush-manifest interpretation, and reusable static and incremental mesh generators. Its lowest geometry layer should return typed arrays plus attribute/index descriptions without depending on Three.js; an optional adapter can construct `BufferGeometry`.
- [`icosa-sketch-assets`](https://github.com/icosa-foundation/icosa-sketch-assets) supplies the maintained Three.js-compatible GLSL and brush textures. Consume those assets without Brushspace-specific shader edits. Production and CI must use a pinned revision, but the files need not be vendored or committed to Brushspace: the browser may load them from stable known URLs, or CI may mirror that revision into a deployment when self-hosting is desired. The asset base URL must be configurable.
- [`three-icosa`](https://github.com/icosa-foundation/three-icosa) supplies brush GUID/name lookup, texture and uniform setup, vertex-attribute binding, render-state selection, and per-frame camera, lighting, fog, and time integration. Use its glTF extension directly for imported glTF sketches.
- Brushspace owns IWSDK entities/systems, controller sampling, interactive painting, sketch lifecycle, UI, undo/erase, collaboration, and a thin IWSDK/XR adapter. That adapter may select `ShaderMaterial` instead of `RawShaderMaterial` and connect IWSDK/super-three XR multiview state, but it should not duplicate parsing, generators, brush bindings, or shader logic.
- Binding changes that are generally useful should be contributed to `three-icosa` only as backward-compatible, separately reviewed changes. The optional material-factory change is the model: existing construction continues to return `RawShaderMaterial`, while IWSDK can explicitly request a non-raw material. Until that isolated change is restored and downstream-tested, Brushspace can subclass or wrap `TiltShaderLoader.parse()` locally to adapt the loaded material without changing shader selection, uniforms, textures, or default behavior.
- Parser and generator changes that are generally useful should be contributed to `three-tiltloader`. Its existing incomplete generic-ribbon implementation is prior art, not a compatibility constraint; replace it behind a new API rather than preserving incorrect behavior.
- Dependency updates must be deliberate: record pinned revisions, build distributable assets reproducibly, and run the representative mesh and browser/XR image gates before advancing any pin. Never push Brushspace integration series directly to a dependency's `main`. Test `gallery-viewer` against the actual modified `three-icosa` checkout, not a neighbouring stale checkout; a successful package build alone is not runtime or visual compatibility evidence.

### Dependency recovery boundary

The Brushspace-driven dependency series have been preserved for reference on
`codex/brushspace-integration` and removed from the dependencies' default
branches. They are not approved pins.

- Approved `icosa-sketch-assets` revision: `1c06159`. It retains the independently
  reviewed Digital/Race shader fix, removes the unused `brushes/legacy`
  directory, and restores `gl_VertexID` for the six maintained particle shaders.
  The rejected `a_texcoord1.w` corner index from `9e7f3a5` is not present because
  active UnityGLTF UV1 export truncates that component and the binding layer does
  not synthesize it. SingleSided and DoubleFlat now sample their declared diffuse
  textures and apply the Unity alpha-cutout contract. Their current stock textures
  are opaque white, so this restores shader behavior without claiming a visible
  stock-image difference. Electricity exposes the displacement modifier required
  to select its three Unity-equivalent material passes.
- Approved `three-icosa` revision: `1868253`, based on trusted revision
  `ab2cd19`. It retains package exports and declarations, the optional material
  factory hook whose default remains `RawShaderMaterial`, and the Digital/Race
  bindings. It applies generated authoritative color-space and sampler metadata
  by default for every known brush texture; an optional texture configurator
  runs afterward as an override, not as the source of correct defaults. Package
  tests and Brushspace browser rendering pass. The earlier exact
  `three-icosa@ab2cd19` distributable was also built into `gallery-viewer` and
  used there to load and render an existing sketch. Revision `1868253` makes the
  required Electricity, Toon, and Tube Toon Inverted material passes normal GLTF
  extension behavior. Gallery Viewer builds from the exact pinned dependency.
  Visible Chrome verifies Tube Toon Inverted with a focused fixture and verifies
  Toon and Electricity within the maintained 48-mesh `all_brushes.glb` sketch.
- Approved `three-tiltloader` revision: `045117a`, based on `5b610c0`. It pins
  the approved `three-icosa` revision without changing the loader API or mesh
  generation. Current trusted `three-tiltloader` work remains the place for reusable live
  mesh generation. Changes there must reproduce the established Open Brush
  export contract rather than require shaders to understand a new
  Brushspace-only layout.

Brushspace pins those approved revisions directly and uses
`three-tiltloader@045117a` for shared geometry generation.
The quarantined integration branches remain diagnostic references only.

This migration does not make the shaders equivalent to the Unity runtime shaders. The maintained web shaders remain ports of Open Brush behavior, and exact fidelity still depends on correct generated vertex contracts, render context, animation inputs, and brush-specific multiple material passes.

Move the implementation upstream incrementally: establish the neutral stroke/geometry result interfaces; move one generator family and its tests; switch Brushspace to the package; repeat for the remaining families; then move `.tilt` parsing once the shared output model is stable. Delete each Brushspace copy only after its upstream replacement passes the existing fixtures.

## Material and shader gaps

### Export shaders are not Unity runtime shader parity

`Support/GlTFShaders` contains Open Brush's export/viewer shaders. They are primary-source approximations, but not translations of every Unity runtime pass, keyword, or render state. Forty-nine local shaders are produced from official templates. UI and reports should distinguish handcrafted export shaders, export templates, web fallbacks, and validated Unity-runtime ports rather than calling all of them the "real shader."

All required material lookups use the maintained dependency path. Brushspace
pins `icosa-sketch-assets@1c06159`, `three-icosa@1868253`, and
`three-tiltloader@045117a`. Browser smoke testing reports 111/111 materials
loaded with no shader compile errors; Oil Paint links with its 1024x1024 normal
texture bound, and separate render gates reject black or empty output from
Electricity, Toon, and Tube Toon Inverted. Dependency provenance and successful
compilation establish source ownership and browser-render eligibility; they do
not establish Unity image parity.
DanceFloor now binds the live generator's particle birth time from `uv1.w` to
the maintained shader's scalar `a_timestamp` input. LeakyPen correctly retains
the Unity live `QuadStripBrush` UV0-only layout: its binding aliases UV0 to the
maintained shader's `a_texcoord1` name because Unity surface-shader
`uv_SecondaryTex` denotes UV0 transformed by `_SecondaryTex_ST` (UV set 1 would
be named `uv2_SecondaryTex`).
Known brush placeholders now preserve the source opaque/cutout or additive render
state even when stroke color alpha is below one; ordinary alpha blending remains
limited to unknown compatibility fallbacks.
Runtime material loading defaults to the immutable approved `icosa-sketch-assets`
revision on jsDelivr and can be redirected with
`VITE_ICOSA_BRUSH_ASSET_BASE_URL`. The submodule is retained as a conformance
source and for the explicit `assets:brushes:mirror`/`build:mirror` self-hosting
path; ordinary development and production builds no longer copy it.

### Vertex data is the limiting contract

The current gate checks `vertexIsDefault` plus explicit Genius, Spray, Midpoint, HyperGrid, Waveform, DoubleTapered, Electricity, Disco, LightWire, Hull, and 3D-print contracts. Even default shaders only match if attribute values have the correct semantics. No extracted brush remains in the `fallback` classification; 12 compatibility-only special generator records remain `unsupported`, all outside the 95-brush target. HyperGrid renders its non-audio export behavior, but real audio-reactive inputs remain absent. The runtime now supplies position, normal, tangent, color, 2D/3D/4D UV0, 3D/4D UV1, vertex IDs, and index where the selected generator defines those semantics.

The active contract is a pipeline, not a direct copy of Unity UV channels:

1. The live brush creates a mesh described by `GeometryPool.VertexLayout`.
2. `OpenBrushExportPlugin` copies that mesh and passes it through
   `BrushBaker.ProcessMesh`. Brush-specific compute-shader mappings in
   `BrushBaker.prefab` can deform vertices and repack values before export.
3. UnityGLTF serializes the baked result. Positions, normals, and tangents receive
   coordinate conversion; ordinary UV0/UV1 are written as `vec2` with V flipped,
   so wider components are not preserved there; the custom UV2 attribute can
   retain `vec2`, `vec3`, or `vec4` data.
4. Three.js `GLTFLoader` creates standard `BufferGeometry` attributes.
5. `three-icosa` detects the `Open Brush UnityGLTF Exporter` generator, remaps
   those attributes to the shader-facing `a_*` names, performs brush-specific
   aliases, and sets `u_isNewTiltExporter`.
6. The maintained shader files in `icosa-sketch-assets` use that flag to select
   the appropriate packing logic. The deleted `brushes/legacy` shader directory
   was not part of this runtime path.

Electricity demonstrates why all stages matter. BrushBaker bakes the time-zero
displacement into position and packs midpoint XY into UV1 and midpoint Z/width
into UV2. UnityGLTF emits those channels, `three-icosa` maps them to
`a_texcoord1`/`a_texcoord2`, and the maintained shader's new-exporter path reads
the split values and removes the baked displacement before applying animation.
Judging either the live mesh layout or shader source alone gives the wrong
contract.

The extent of live-versus-export differences is therefore brush-specific. Many
unmapped brushes pass through with only ordinary exporter conversion, while the
20 configured BrushBaker mappings and the special `three-icosa` remaps can
change packing substantially. Audit the final shader-facing geometry rather
than assuming a uniform semantic conversion.

The recovery rule is: `three-tiltloader` must reproduce the final contract
expected by the maintained shader and binding path, including component widths,
packing, corner order, indexing, time domain, and exporter flag. Fixtures should
capture the live Unity mesh, post-BrushBaker mesh, exported GLB attributes,
post-`three-icosa` `BufferGeometry`, selected shader branch, and generated
`three-tiltloader` geometry for every mapped/special family.

### Descriptor data is extracted but unused

Records contain tile rate, atlas count, backface settings, radius packing, opacity, audio-reactive flags, color constraints, pressure ranges, and solid minimum length. Ribbon and tube generation now consumes many of these fields, but head/tail rules and several special-generator settings remain metadata only. Thirty-two records are marked audio-reactive, but brush materials have no beat/FFT/waveform input pipeline; draw sounds are a separate feature.

### Texture semantics are flattened

Extraction and loading preserve sRGB/linear intent, per-axis wrapping, filter mode,
mipmap generation, and anisotropy, and runtime `_TexelSize` uniforms now use the
actual loaded image dimensions. The trusted `three-icosa` path supplies authored
texture scale/offset uniforms and applies generated Unity color-space, wrapping,
mipmap, filter, and anisotropy settings as loader defaults for all consumers.
Brushspace applies the same extracted metadata only on its non-authoritative
fallback material path. Compression/transcoding, platform overrides, mip bias, and
full Unity alpha/import semantics remain unported.
The exported derivative bump branch made lit brushes render entirely black on
physical Quest hardware. A guarded replacement is now the default: it clamps
degenerate gradients and falls back per fragment, passes the Oil Paint pixel A/B
check with a material difference, and renders a real generated Oil Paint stroke
in desktop Chrome without black output. `?bump-mapping=fallback` retains an
explicit flat-normal escape hatch. Physical-Quest verification is still required
before this can be classified as fully validated rather than likely mostly correct.

### Render state and environment are partial

The runtime maps broad blend mode, transparency, and depth write. Three-icosa
now applies the extracted `renderBackfaces` contract to all 95 required brushes,
and the fallback material path uses the same field rather than the conflicting
material `enableCull` flag. Render queue, arbitrary blend factors, ZTest/ZWrite
variants, color masks, alpha-to-coverage, polygon offset, explicit backface
passes, and premultiplied alpha remain unvalidated. Lighting/fog is fixed to one
Standard viewer rig rather than loaded sketch/environment state.

### Diagnostics and extraction regression

Shader loads and warmups record durable per-GUID compatibility results, and existing
fallback meshes are upgraded when their shader material becomes available. The
visual conformance routes now also persist per-GUID pass/fail results with coverage,
timestamp, and runtime identity. The remaining diagnostic gap is a complete
browser/Quest compile and image-comparison matrix tied to the visual reference
corpus. Extraction now writes the catalog consumed by the runtime and checks
generated additive shaders for unresolved emission macros.

## Required fidelity harness

Current unit tests validate array shapes, simple frames, pressure multipliers, inventory decisions, and material descriptors; they do not establish visual parity. Build a conformance harness that:

1. Feeds identical deterministic strokes into Unity and the browser: line, arc, helix, sharp corner, reversal, pressure ramp, twist, dot, long stroke, and segment break.
2. Dumps finalized Unity positions, indices, normals, tangents, colors, UV0-UVn, bounds, and material state for every GUID.
3. Compares topology exactly where the algorithm is ported; otherwise compares surfaces and semantic attributes with declared tolerances.
4. Renders fixed camera/environment fixtures and compares linear images before and after post-processing.
5. Compiles and screenshots on desktop WebGL and immersive XR/Quest.
6. Publishes per-GUID results for mesh contract, browser/XR compile, image error, animation, ordering, and performance.

Do not create a second synthetic visual baseline. The pinned Open Brush checkout
already contains the authoritative brush fixture generator at
`Assets/Editor/UiScreenshotter.cs` and material reference images under
`Support/Screenshots/postfx-disabled/` (for example `brush-OilPaint.png` and
`brush-DuctTape.png`). `Generate Brush Screenshots` draws the same deterministic
path for every catalog brush, uses the black environment
`580b4529-ac50-4fe9-b8d2-635765a14893`, fixes shader time at 0.5 seconds, disables
post-processing, renders at 2x supersampling with 4x MSAA, and downsamples to
1024x1024. Browser reference renders should reproduce that path, framing,
environment, time, resolution, and post-processing state before image comparison.

Use IWSDK's live runtime inspection for browser verification. Locate the actual
`BrushStroke` entity by brush GUID, inspect its ECS fields, scene transform,
generated geometry, assigned material, shader uniforms, and compatibility result,
then capture the real application render. A synthetic quad may be used only as a
coarse shader-compilation/effect smoke check; it is not evidence that a generated
brush stroke looks correct. The minimum debugging sequence is typecheck, connect
to the existing IWSDK runtime, inspect the real stroke entity/material, check all
browser logs, and screenshot the live scene.

Suggested gates:

- Do not label a brush `supported` without mesh-contract and browser/XR compile passes.
- Default-picker brushes: SSIM >= 0.97 under two fixed views, with manual alpha/additive review.
- Animated brushes: compare at 0, 0.5, 1, and 2 seconds.
- Quest target: 72 Hz at a documented vertex/stroke budget with bounded draw calls and no first-use shader hitch.

## Improvement plan

### Phase 0: trustworthy baseline (1-2 engineer-weeks)

1. Resolve the `9e7f3a5` indexed-particle audit, construct an approved
   `icosa-sketch-assets` revision from the safe baseline plus the independently
   retained Digital/Race and legacy-directory cleanup changes, and advance
   `three-icosa` only through separately reviewed backward-compatible changes.
   Retain quarantined revisions only as diagnostic
   references. Record the exact dependency and asset URL revisions used by CI
   and production.
2. Replace the source-tree asset submodule/copy assumption with a configurable
   asset base URL. Load the pinned known URLs directly by default; optionally
   mirror the same revision during deployment when a self-hosted/offline copy is
   required. Verify mirrored files byte-for-byte and do not commit generated
   copies.
3. Implemented: `open-brush-reference.json` pins the audited upstream commit,
   and asset extraction rejects a checkout at any other revision.
4. Fix extraction output and regenerate through a temporary-directory byte comparison in CI.
5. Extract every required prefab field, vertex layout, texture importer setting, render state, keyword, and environment dependency.
6. Add pipeline fixtures spanning live mesh, post-BrushBaker mesh, UnityGLTF
   attributes, post-`three-icosa` shader attributes, selected maintained-shader
   branch, and `three-tiltloader` output. Cover all 20 BrushBaker mappings plus
   ordinary pass-through, special `three-icosa` remaps, and indexed/non-indexed
   particle cases where supported.
7. Partially implemented: evidence states distinguish asset readiness, renderer
   eligibility, mesh contract, browser compile, XR compile, and persisted visual
   results. CI also checks active vertex/fragment varying links across all 95
   required authoritative shader pairs. Mesh/image fixture automation and a
   complete XR matrix remain open.
8. Partially implemented: the browser route now reproduces the existing Open
   Brush `UiScreenshotter` path, perspective framing, fixed shader time, and
   stroke seed without generator-specific control-point mutations. Unity mesh
   dumping and automated image comparison remain open;
   do not replace the existing screenshot corpus with a new visual target.

Exit: CI explains exactly why every GUID passes or fails.

### Phase 1: exact ribbons (3-5 engineer-weeks)

1. Establish the typed-array stroke/geometry API in `three-tiltloader`, move the ribbon generators and tests there, and consume them from Brushspace.
2. Port knot smoothing, frame, breaks, and incremental rebuild rules.
3. Split distance, stretch, and unitized UV algorithms.
4. Add physical-length UVs, tile rate, atlas rows, deterministic offsets, and segment restart.
5. Emit explicit backfaces/hue shift, normals, tangents, and source vertex layouts.
6. Apply opacity and color constraints.
7. Validate DoubleTapered and Electricity against Unity mesh/image fixtures.

Exit: default ribbon fixtures pass mesh and image gates.

### Phase 2: exact tubes (3-5 engineer-weeks)

1. Move the tube generators and tests into `three-tiltloader` and switch Brushspace to the shared API.
2. Honor side count, caps, hard edges, UV style, break sensitivity, and modifiers per prefab.
3. Port source cap/ring topology and circumference-based UVs.
4. Add radius packing and tangents.
5. Validate Disco and LightWire deformation against Unity mesh/image fixtures.
6. Validate culling rather than forcing tubes double-sided.

Exit: tube topology/attributes match Unity and default tubes pass images.

### Phase 3: materials and shader context (3-6 engineer-weeks, overlaps 1-2)

1. Implemented: repin the three dependencies to the reviewed revisions and load
   all 111 configured materials without modifying maintained shader source.
2. Implemented upstream and package-tested: the optional `three-icosa` material
   factory preserves the existing default `RawShaderMaterial` and adds an
   explicit opt-in factory. Still required: visually exercise `gallery-viewer`
   against the exact pinned checkout.
3. Define a typed vertex-layout registry shared by `three-tiltloader` geometry and the Brushspace/`three-icosa` binding adapter.
4. Preserve the authoritative texture color/sampler metadata.
5. Complete render-state mapping without introducing transparency behavior absent from Open Brush.
6. Drive lights, fog, time origin, canvas transform, and other globals from the loaded sketch/environment.
7. Implement multiple material-pass composition in Brushspace when the maintained assets
   already expose the required pass. If they do not, classify the pass as an
   upstream asset limitation instead of rewriting the shader during integration.
8. Implement real audio-analysis inputs or classify those variants as non-reactive.
9. Remove the obsolete extracted shader corpus and duplicated binding tables only after all required brushes resolve through the trusted dependencies.
10. Add per-GUID diagnostics and late material upgrades.
11. Validate bloom/tone mapping on desktop and Quest.

### Phase 4: particles (5-8 engineer-weeks)

1. Move the particle generators and tests into `three-tiltloader` and switch Brushspace to the shared API.
2. Port deterministic stateless RNG and Open Brush salts.
3. Port distance-based spawning and generator-specific placement.
4. Add 4D UV0, UV1/UV2, center, birth, rotation, velocity, and vertex ID attributes.
5. Port preview decay and finalization.
6. Validate phase after `.tilt` load, collaboration, and undo/redo.

Exit: all 17 particle-family brushes have tested behavior; no static-quad placeholder remains.

### Phase 5: required special generators (implemented)

The required hull, ConcaveHull, ThickGeometry, SquarePaper, and 3D Printing
Brush paths are implemented. Remaining work is fixture-level parity and
hardening rather than an unmapped required generator.
Compatibility-only Blocks, Plait/Braid, holiday, SVG, PBR, and environment
cases are explicitly outside the 95-brush target and remain import-only until
their scope is reconsidered.

### Phase 6: batching and hardening (4-8 engineer-weeks)

1. Pool finalized geometry by brush/material/layer.
2. Keep small dynamic buffers for active local and remote strokes.
3. Add culling, compaction, erase/undo bookkeeping, and transparent buckets.
4. Test thousands of strokes, collaboration, context loss, and Quest memory pressure.

## Recommended sequence

Do not treat all 123 extracted records as the fidelity target. The highest-yield order is: conformance tooling; exact geometry for the 48 standard brushes; material/texture semantics for those brushes; batching sufficient for real sketches; then the 47 non-broken experimental brushes. A shader should not be declared complete against an approximate vertex contract.

## Effort and full-port appraisal

Assumptions: senior WebGL/TypeScript and Open Brush/Unity expertise, Quest-capable WebXR, existing application features retained, and automated tests included.

| Goal | Estimated work |
| --- | ---: |
| Harness and extraction metadata | 1-2 engineer-weeks |
| High-fidelity 48-brush standard set | 12-22 engineer-weeks |
| All 95 required brush mesh/material families | 24-42 engineer-weeks total |
| Batching/performance hardening | 4-8 additional engineer-weeks |
| Broad Open Brush application parity | 18-36 engineer-months total program |

A two-person graphics-focused team could plausibly deliver a validated default set in 2-4 calendar months and broad stock-brush coverage in 6-10 months, assuming no major browser/driver blocker.

"Fully working port" is much larger. The reviewed Open Brush tree has about 786 C# files under `Assets/Scripts` (about 7.35 MB); Brushspace has 84 non-test TypeScript files (about 23,400 lines). This is not a productivity comparison, but shows the product-surface difference. Open Brush includes mature selection/modification, media, camera/video, environments, guides/snapping, layers/groups, import/export, platform integrations, scripting/plugins, and extensive UI/settings beyond this brush review.

Brushspace already implements a credible subset—painting, straightedge/tape, erasing, brush/color UI, undo/redo, local persistence, partial `.tilt`, GLB export, collaboration, snapshots, and world grab—but these are adaptations rather than close Unity translations. Upstream changes generally require manual reinterpretation.

Broad parity is therefore a multi-year solo effort or roughly a 9-18 month program for a focused 3-5 person team, depending on which platform-specific features are intentionally omitted.

## Immediate backlog

1. Implemented: Gallery Viewer pins `three-icosa@1868253` and builds its deployed
   module from that exact dependency. The loader applies required brush material
   passes automatically. Its visible-Chrome gate verifies Tube Toon Inverted
   against a focused fixture and verifies Toon plus all 48 shader meshes in the
   maintained `all_brushes.glb` sketch. The same existing-sketch gate verifies
   Electricity's three distinct displacement modifiers and groups. Brushspace
   consumes the exported pass/group helper for Electricity and both Toon brushes
   rather than duplicating their material construction. Digital and Race retain
   dedicated dependency tests.
2. Implemented: runtime assets use a configurable immutable pinned URL by
   default, with explicit mirror commands for self-hosted/offline builds.
3. Implemented: `npm run dev:http` provides a repeatable local HTTP route that
   never invokes CA installation. `npm run test:browser:materials` runs the
   111/111 WebGL compile check and deterministic Oil Paint coverage gate in
   installed Chrome, locally and in CI. The same gate renders Electricity and
   both Toon brushes and rejects black or empty output.
4. Add live Unity, post-BrushBaker, exported GLB, and post-`three-icosa` geometry
   dumps to the deterministic fixture and compare the final shader-facing
   contract with `three-tiltloader` output.
5. Implemented: reproduce that fixture path, camera, seed, and fixed shader time
   in the browser for per-GUID comparison.
6. Replace renderer-eligibility labels with persisted mesh/browser/XR/image evidence.
7. Fail loudly when an extracted required vertex contract is unimplemented.
8. In progress: self-intersection width shrinking and finalized second-pass
   FlatGeometry smoothing are implemented; incremental adjacent-knot rebuild
   behavior still needs parity.
9. Byte-compare tube caps/rings and port Disco and LightWire layouts.
10. Port preview decay and exact time conversion by producing the established
    particle attributes; do not add Brushspace-specific shader inputs.
11. Connect batching to production rendering.
12. Persist the browser/Quest shader compile matrix.
13. Implemented: preserve trusted texture transforms, render states, and
    extracted importer sampler/color-space settings. Guarded normal
    mapping still requires verification on physical Quest.
14. Move reusable `.tilt` parsing and mesh generators into `three-tiltloader` family by family, switching Brushspace to each upstream implementation before deleting its local copy.

## Primary references

- [Open Brush brush sources](https://github.com/icosa-foundation/open-brush/tree/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/Brushes)
- [`BaseBrushScript.cs`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/Brushes/BaseBrushScript.cs)
- [`QuadStripBrush.cs`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/Brushes/QuadStripBrush.cs)
- [`TubeBrush.cs`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/Brushes/TubeBrush.cs)
- [`GeniusParticlesBrush.cs`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/Brushes/GeniusParticlesBrush.cs)
- [`Export.cs`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/Export/Export.cs)
- [`OpenBrushExportPlugin.cs`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/UnityGLTF%20Plugins/OpenBrushExportPlugin.cs)
- [`BrushBaker.cs`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Scripts/Export/BrushBaker.cs)
- [`BrushBaker.prefab`](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Prefabs/BrushBaker.prefab)
- [Export shader sources](https://github.com/icosa-foundation/open-brush/tree/4786d55ad398bfc957d8e8eb26438920026aeaf6/Support/GlTFShaders)
- [Export manifest](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Support/exportManifest.json)
- [Brush screenshot generator](https://github.com/icosa-foundation/open-brush/blob/4786d55ad398bfc957d8e8eb26438920026aeaf6/Assets/Editor/UiScreenshotter.cs)
- Open Brush reference corpus path: `Support/Screenshots/postfx-disabled/`
- [IWSDK](https://iwsdk.dev/) live scene/ECS inspection and browser/XR runtime tools
- [`icosa-sketch-assets`](https://github.com/icosa-foundation/icosa-sketch-assets) maintained web shader and texture assets
- [`three-icosa`](https://github.com/icosa-foundation/three-icosa) Three.js Open Brush material extension and bindings
- [`GOOGLE_tilt_brush_material.js`](https://github.com/icosa-foundation/three-icosa/blob/main/src/loader/GOOGLE_tilt_brush_material.js) active exported-geometry attribute remapping and exporter detection
- [`three-tiltloader`](https://github.com/icosa-foundation/three-tiltloader) intended shared `.tilt` parsing and brush-geometry package

## Verification note

The initial report was a source and asset audit. Subsequent implementation commits
are gated by TypeScript checking, the full Vitest suite, a production Vite build,
live Chrome rendering when the browser connection is available, and the GitHub
Pages workflow. Those checks catch compilation and gross rendering failures but
do not constitute Unity image or mesh conformance. Physical Quest verification
is still required for shader changes; guarded normal mapping is enabled by default
after desktop A/B and real-stroke gates, but the prior headset black-output failure
means on-device evidence remains mandatory.
