export interface PixelDifference {
  comparedPixelRatio: number;
  changedPixelRatio: number;
  meanAbsoluteDifference: number;
  rootMeanSquareDifference: number;
}

export function compareRgbPixels(
  actual: Uint8Array,
  control: Uint8Array,
): PixelDifference {
  if (actual.length !== control.length || actual.length % 4 !== 0) {
    throw new Error("Pixel buffers must be equally sized RGBA data.");
  }
  let changedPixels = 0;
  let comparedPixels = 0;
  let absoluteDifference = 0;
  let squaredDifference = 0;
  const pixelCount = actual.length / 4;
  for (let offset = 0; offset < actual.length; offset += 4) {
    if (actual[offset + 3] === 0 && control[offset + 3] === 0) {
      continue;
    }
    comparedPixels += 1;
    let pixelChanged = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = Math.abs(actual[offset + channel] - control[offset + channel]);
      absoluteDifference += difference;
      squaredDifference += difference * difference;
      pixelChanged ||= difference >= 3;
    }
    changedPixels += Number(pixelChanged);
  }
  const sampleCount = comparedPixels * 3;
  return {
    comparedPixelRatio: comparedPixels / pixelCount,
    changedPixelRatio: comparedPixels > 0 ? changedPixels / comparedPixels : 0,
    meanAbsoluteDifference:
      sampleCount > 0 ? absoluteDifference / sampleCount : 0,
    rootMeanSquareDifference:
      sampleCount > 0 ? Math.sqrt(squaredDifference / sampleCount) : 0,
  };
}
