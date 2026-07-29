export const OPEN_BRUSH_DEFAULT_SIZE01 = 0.5;
export type BrushSizeRange = readonly [number, number];
export interface ResolvedBrushSize {
  size01: number;
  size: number;
}

export const OPEN_BRUSH_DEFAULT_BRUSH_SIZE_RANGE: BrushSizeRange = [0.05, 3];
export const OPEN_BRUSH_BRUSH_SIZE_BUTTON_STEP = 0.05;

// Open Brush stores normalized BrushSize01 in UI state and absolute brushSize
// on strokes. Descriptor size ranges are authored in Tilt Brush world units,
// which are decimeters (App.UNITS_TO_METERS = 0.1 in the reference); the app
// draws at 1:1 room scale in meters, so live size is the plain unit conversion.
export const OPEN_BRUSH_UNITS_TO_METERS = 0.1;
export const OPEN_BRUSH_IWSDK_BRUSH_SIZE_SCALE = OPEN_BRUSH_UNITS_TO_METERS;
export const OPEN_BRUSH_DEFAULT_STARTUP_BRUSH_SIZE_RANGE: BrushSizeRange = [
  0.05,
  0.2,
];
export const OPEN_BRUSH_DEFAULT_STARTUP_LIVE_BRUSH_SIZE =
  brushSize01ToLiveBrushSize(
    OPEN_BRUSH_DEFAULT_SIZE01,
    OPEN_BRUSH_DEFAULT_STARTUP_BRUSH_SIZE_RANGE,
  );
export const OPEN_BRUSH_DEFAULT_STARTUP_SCREENSHOT_BRUSH_SIZE =
  brushSize01ToOpenBrushSize(
    OPEN_BRUSH_DEFAULT_SIZE01,
    OPEN_BRUSH_DEFAULT_STARTUP_BRUSH_SIZE_RANGE,
  );
export const OPEN_BRUSH_THUMBSTICK_SIZE_DEADZONE = 0.18;
export const OPEN_BRUSH_THUMBSTICK_SIZE_RATE01_PER_SECOND = 0.35;

export function normalizeBrushSize(size: number): number {
  if (!Number.isFinite(size) || size <= 0) {
    return OPEN_BRUSH_DEFAULT_STARTUP_LIVE_BRUSH_SIZE;
  }
  return size;
}

export function normalizeBrushSize01(size01: number): number {
  if (!Number.isFinite(size01)) {
    return OPEN_BRUSH_DEFAULT_SIZE01;
  }
  if (size01 < 0) {
    return 0;
  }
  if (size01 > 1) {
    return 1;
  }
  return size01;
}

export function normalizeBrushSizeRange(
  range: BrushSizeRange | undefined,
): BrushSizeRange {
  if (!range) {
    return OPEN_BRUSH_DEFAULT_BRUSH_SIZE_RANGE;
  }
  const [min, max] = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max <= 0) {
    return OPEN_BRUSH_DEFAULT_BRUSH_SIZE_RANGE;
  }
  if (max < min) {
    return [max, min];
  }
  return [min, max];
}

export function brushSize01ToLiveBrushSize(
  size01: number,
  range?: BrushSizeRange,
): number {
  return (
    brushSize01ToOpenBrushSize(size01, normalizeBrushSizeRange(range)) *
    OPEN_BRUSH_IWSDK_BRUSH_SIZE_SCALE
  );
}

/**
 * Open Brush preserves the absolute brush size when switching brushes
 * (PointerScript.m_LastUsedBrushSize_CS): the current size carries over,
 * clamped into the new brush's range, and size01 is re-derived from it.
 */
export function resolveBrushSizeForBrushChange(
  currentLiveSize: number,
  range?: BrushSizeRange,
): ResolvedBrushSize {
  const normalizedRange = normalizeBrushSizeRange(range);
  const minLive = normalizedRange[0] * OPEN_BRUSH_IWSDK_BRUSH_SIZE_SCALE;
  const maxLive = normalizedRange[1] * OPEN_BRUSH_IWSDK_BRUSH_SIZE_SCALE;
  const size = Math.min(
    maxLive,
    Math.max(minLive, normalizeBrushSize(currentLiveSize)),
  );
  return { size01: liveBrushSizeToSize01(size, normalizedRange), size };
}

export function resolveBrushSize01Adjustment(
  currentSize01: number,
  delta: number,
  range?: BrushSizeRange,
): ResolvedBrushSize {
  const size01 = normalizeBrushSize01(
    normalizeBrushSize01(currentSize01) + delta,
  );
  return {
    size01,
    size: brushSize01ToLiveBrushSize(size01, range),
  };
}

export function resolveBrushSizeThumbstickAdjustment(
  currentSize01: number,
  axisX: number,
  deltaSeconds: number,
  range?: BrushSizeRange,
): ResolvedBrushSize {
  const normalizedAxis = normalizeBrushSizeThumbstickAxis(axisX);
  const delta =
    normalizedAxis *
    Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0) *
    OPEN_BRUSH_THUMBSTICK_SIZE_RATE01_PER_SECOND;
  return resolveBrushSize01Adjustment(currentSize01, delta, range);
}

export function normalizeBrushSizeThumbstickAxis(axisX: number): number {
  if (!Number.isFinite(axisX)) {
    return 0;
  }
  const clamped = Math.min(1, Math.max(-1, axisX));
  const magnitude = Math.abs(clamped);
  if (magnitude <= OPEN_BRUSH_THUMBSTICK_SIZE_DEADZONE) {
    return 0;
  }
  return (
    Math.sign(clamped) *
    ((magnitude - OPEN_BRUSH_THUMBSTICK_SIZE_DEADZONE) /
      (1 - OPEN_BRUSH_THUMBSTICK_SIZE_DEADZONE))
  );
}

export function liveBrushSizeToSize01(
  liveBrushSize: number,
  range?: BrushSizeRange,
): number {
  return openBrushSizeToBrushSize01(
    normalizeBrushSize(liveBrushSize) / OPEN_BRUSH_IWSDK_BRUSH_SIZE_SCALE,
    normalizeBrushSizeRange(range),
  );
}

export function brushSize01ToOpenBrushSize(
  size01: number,
  range?: BrushSizeRange,
): number {
  const [min, max] = normalizeBrushSizeRange(range);
  const minRadius = fromRadius(min);
  const maxRadius = fromRadius(max);
  return toRadius(lerp(minRadius, maxRadius, normalizeBrushSize01(size01)));
}

export function openBrushSizeToBrushSize01(
  brushSize: number,
  range?: BrushSizeRange,
): number {
  const [min, max] = normalizeBrushSizeRange(range);
  const minRadius = fromRadius(min);
  const maxRadius = fromRadius(max);
  if (maxRadius === minRadius) {
    return 0;
  }
  return normalizeBrushSize01(
    (fromRadius(brushSize) - minRadius) / (maxRadius - minRadius),
  );
}

function fromRadius(value: number): number {
  return Math.sqrt(Math.max(value, 0));
}

function toRadius(value: number): number {
  return value * value;
}

function lerp(min: number, max: number, amount: number): number {
  return min + (max - min) * amount;
}
