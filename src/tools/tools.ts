export type OpenBrushToolId =
  | "free-paint"
  | "eraser"
  | "straightedge"
  | "mirror"
  | "grid-snap"
  | "lazy-input"
  | "tape"
  | "stencil"
  | "dropper"
  | "camera";

export type OpenBrushToolSamplingMode =
  | "none"
  | "freehand"
  | "straightedge"
  | "tape";
export type OpenBrushToolMirrorMode = "none" | "x";
export type OpenBrushToolSnapMode = "none" | "grid";
export type OpenBrushToolLazyMode = "none" | "position";
export type OpenBrushToolStencilMode = "none" | "front-plane";

// EraserTool m_SizeRange {0.1, 0.3} is in Tilt Brush units (decimeters);
// runtime radii are meters, so the eraser sphere spans 1-3 cm.
export const OPEN_BRUSH_ERASER_SIZE_RANGE = [0.01, 0.03] as const;
export const OPEN_BRUSH_DEFAULT_ERASER_RADIUS =
  (OPEN_BRUSH_ERASER_SIZE_RANGE[0] + OPEN_BRUSH_ERASER_SIZE_RANGE[1]) * 0.5;
export const OPEN_BRUSH_ERASER_SIZE_BUTTON_STEP01 = 0.05;
// The pointer tip pose already carries the forward offset, so the eraser
// sphere sits exactly on the drawing tip (EraserTool snaps its sphere to the
// same tool attach point).
export const OPEN_BRUSH_ERASER_FORWARD_OFFSET = 0;
/** Forward offset from the ray space to the drawing tip (PointerScript). */
export const OPEN_BRUSH_POINTER_TIP_FORWARD_OFFSET = 0.045;
/**
 * Grip-local pose of the tip anchor, tuned in-headset — the Quest browser
 * reports bad target-ray-space poses, so the draw head hangs off the grip
 * space with this offset. The left hand mirrors the tuned right-hand values
 * across the X axis.
 */
export const OPEN_BRUSH_TIP_ANCHOR_POSITION_RIGHT: readonly [
  number, number, number,
] = [-0.0224, -0.0382, -0.054];
export const OPEN_BRUSH_TIP_ANCHOR_QUATERNION_RIGHT: readonly [
  number, number, number, number,
] = [-0.4756, 0.0477, -0.2559, 0.8403];
export const OPEN_BRUSH_TIP_ANCHOR_POSITION_LEFT: readonly [
  number, number, number,
] = [0.0224, -0.0382, -0.054];
export const OPEN_BRUSH_TIP_ANCHOR_QUATERNION_LEFT: readonly [
  number, number, number, number,
] = [-0.4756, -0.0477, 0.2559, 0.8403];
// EraserTool spin feedback while the trigger is held (degrees converted to
// radians: m_MaxSpinSpeed 500, m_SpinSpeedAcceleration 40000, m_SpinSpeedDecay
// 2500).
export const OPEN_BRUSH_ERASER_MAX_SPIN_SPEED = (500 * Math.PI) / 180;
export const OPEN_BRUSH_ERASER_SPIN_ACCELERATION = (40000 * Math.PI) / 180;
export const OPEN_BRUSH_ERASER_SPIN_DECAY = (2500 * Math.PI) / 180;
export const OPEN_BRUSH_DROPPER_PICK_RADIUS = 0.1;
export const OPEN_BRUSH_DROPPER_FORWARD_OFFSET = 0.22;

export interface OpenBrushPickerToolSpec {
  picksColor: boolean;
  picksBrush: boolean;
  picksSize: boolean;
  radius: number;
  forwardOffset: number;
  pickedStatusLabel: string;
}

export interface OpenBrushEraserSize {
  size01: number;
  radius: number;
}

export function normalizeOpenBrushEraserRadius(radius: number): number {
  if (!Number.isFinite(radius)) {
    return OPEN_BRUSH_DEFAULT_ERASER_RADIUS;
  }
  return Math.min(
    OPEN_BRUSH_ERASER_SIZE_RANGE[1],
    Math.max(OPEN_BRUSH_ERASER_SIZE_RANGE[0], radius),
  );
}

export function openBrushEraserSize01ToRadius(size01: number): number {
  const normalized = normalize01(size01);
  return (
    OPEN_BRUSH_ERASER_SIZE_RANGE[0] +
    (OPEN_BRUSH_ERASER_SIZE_RANGE[1] - OPEN_BRUSH_ERASER_SIZE_RANGE[0]) *
      normalized
  );
}

export function openBrushEraserRadiusToSize01(radius: number): number {
  const range =
    OPEN_BRUSH_ERASER_SIZE_RANGE[1] - OPEN_BRUSH_ERASER_SIZE_RANGE[0];
  if (range <= 0) {
    return 1;
  }
  return normalize01(
    (normalizeOpenBrushEraserRadius(radius) - OPEN_BRUSH_ERASER_SIZE_RANGE[0]) /
      range,
  );
}

export function resolveOpenBrushEraserSizeAdjustment(
  currentRadius: number,
  delta01: number,
): OpenBrushEraserSize {
  const size01 = normalize01(
    openBrushEraserRadiusToSize01(currentRadius) + delta01,
  );
  return {
    size01,
    radius: openBrushEraserSize01ToRadius(size01),
  };
}

export interface OpenBrushToolDescriptor {
  id: OpenBrushToolId;
  label: string;
  status: string;
  paints: boolean;
  erases: boolean;
  samplingMode: OpenBrushToolSamplingMode;
  mirrorMode: OpenBrushToolMirrorMode;
  snapMode: OpenBrushToolSnapMode;
  lazyMode: OpenBrushToolLazyMode;
  stencilMode: OpenBrushToolStencilMode;
}

export type OpenBrushPanelFocusStatus =
  | "draw-panel-focus"
  | "erase-panel-focus"
  | "pick-panel-focus";

const OPEN_BRUSH_PANEL_FOCUS_STATUSES = new Set<string>([
  "draw-panel-focus",
  "erase-panel-focus",
  "pick-panel-focus",
]);

export const openBrushTools: readonly OpenBrushToolDescriptor[] = [
  {
    id: "free-paint",
    label: "Draw",
    status: "draw-ready",
    paints: true,
    erases: false,
    samplingMode: "freehand",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "none",
  },
  {
    id: "eraser",
    label: "Eraser",
    status: "erase-ready",
    paints: false,
    erases: true,
    samplingMode: "none",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "none",
  },
  {
    id: "straightedge",
    label: "Straightedge",
    status: "line-ready",
    paints: true,
    erases: false,
    samplingMode: "straightedge",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "none",
  },
  {
    id: "mirror",
    label: "Mirror",
    status: "mirror-ready",
    paints: true,
    erases: false,
    samplingMode: "freehand",
    mirrorMode: "x",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "none",
  },
  {
    id: "grid-snap",
    label: "Grid Snap",
    status: "grid-ready",
    paints: true,
    erases: false,
    samplingMode: "freehand",
    mirrorMode: "none",
    snapMode: "grid",
    lazyMode: "none",
    stencilMode: "none",
  },
  {
    id: "lazy-input",
    label: "Lazy Input",
    status: "lazy-ready",
    paints: true,
    erases: false,
    samplingMode: "freehand",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "position",
    stencilMode: "none",
  },
  {
    id: "tape",
    label: "Tape",
    status: "tape-ready",
    paints: true,
    erases: false,
    samplingMode: "tape",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "none",
  },
  {
    id: "stencil",
    label: "Stencil",
    status: "stencil-ready",
    paints: true,
    erases: false,
    samplingMode: "freehand",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "front-plane",
  },
  {
    id: "dropper",
    label: "Dropper",
    status: "dropper-pending",
    paints: false,
    erases: false,
    samplingMode: "none",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "none",
  },
  {
    id: "camera",
    label: "Camera",
    status: "camera-ready",
    paints: false,
    erases: false,
    samplingMode: "none",
    mirrorMode: "none",
    snapMode: "none",
    lazyMode: "none",
    stencilMode: "none",
  },
];


export function resolveOpenBrushTool(toolId: string): OpenBrushToolDescriptor {
  return (
    openBrushTools.find((tool) => tool.id === toolId) ?? openBrushTools[0]
  );
}

export function resolveOpenBrushPanelFocusStatus(
  tool: OpenBrushToolDescriptor,
): OpenBrushPanelFocusStatus {
  if (tool.erases) {
    return "erase-panel-focus";
  }
  if (resolveOpenBrushPickerToolSpec(tool.id)) {
    return "pick-panel-focus";
  }
  return "draw-panel-focus";
}

export function isOpenBrushPanelFocusStatus(status: string): boolean {
  return OPEN_BRUSH_PANEL_FOCUS_STATUSES.has(status);
}

export function isOpenBrushToolId(toolId: string): toolId is OpenBrushToolId {
  return openBrushTools.some((tool) => tool.id === toolId);
}

// DropperTool scene config: m_DropperBrushSelectRadius 0.1,
// m_PointerForwardOffset 0.22; the dropper picks brush, size, and color in
// one action (there are no partial pick tools in Open Brush).
const dropperToolSpec: OpenBrushPickerToolSpec = {
  picksColor: true,
  picksBrush: true,
  picksSize: true,
  radius: OPEN_BRUSH_DROPPER_PICK_RADIUS,
  forwardOffset: OPEN_BRUSH_DROPPER_FORWARD_OFFSET,
  pickedStatusLabel: "dropper",
};

export function resolveOpenBrushPickerToolSpec(
  toolId: string,
): OpenBrushPickerToolSpec | undefined {
  return toolId === "dropper" ? dropperToolSpec : undefined;
}

export function getNextOpenBrushTool(
  toolId: string,
  offset: number,
): OpenBrushToolDescriptor {
  const currentTool = resolveOpenBrushTool(toolId);
  const currentIndex = openBrushTools.findIndex(
    (tool) => tool.id === currentTool.id,
  );
  const nextIndex =
    (currentIndex + offset + openBrushTools.length) % openBrushTools.length;
  return openBrushTools[nextIndex];
}

function normalize01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}
