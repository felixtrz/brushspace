import { pathToFileURL } from "node:url";

import sharp from "sharp";

const COVERAGE_RGB_SUM = 3;

export function compareBrushImagePixels(actual, reference, width, height) {
  const expectedLength = width * height * 4;
  if (actual.length !== expectedLength || reference.length !== expectedLength) {
    throw new Error("Brush images must be equally sized RGBA buffers.");
  }

  const actualShape = createShapeAccumulator();
  const referenceShape = createShapeAccumulator();
  let intersection = 0;
  let union = 0;
  let absoluteDifference = 0;
  let squaredDifference = 0;

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    const actualCovered = isCovered(actual, offset);
    const referenceCovered = isCovered(reference, offset);
    accumulateShape(actualShape, actualCovered, x, y);
    accumulateShape(referenceShape, referenceCovered, x, y);
    intersection += Number(actualCovered && referenceCovered);
    union += Number(actualCovered || referenceCovered);
    for (let channel = 0; channel < 3; channel += 1) {
      const difference = actual[offset + channel] - reference[offset + channel];
      absoluteDifference += Math.abs(difference);
      squaredDifference += difference * difference;
    }
  }

  const channelCount = width * height * 3;
  return {
    width,
    height,
    actual: finishShape(actualShape, width, height),
    reference: finishShape(referenceShape, width, height),
    silhouetteIntersectionOverUnion: union === 0 ? 1 : intersection / union,
    meanAbsoluteDifference: absoluteDifference / channelCount,
    rootMeanSquareDifference: Math.sqrt(squaredDifference / channelCount),
  };
}

async function compareFiles(actualPath, referencePath) {
  const [actual, reference] = await Promise.all([
    readRgba(actualPath),
    readRgba(referencePath),
  ]);
  if (
    actual.info.width !== reference.info.width ||
    actual.info.height !== reference.info.height
  ) {
    throw new Error(
      `Brush image dimensions differ: ${actual.info.width}x${actual.info.height} versus ${reference.info.width}x${reference.info.height}.`,
    );
  }
  return compareBrushImagePixels(
    actual.data,
    reference.data,
    actual.info.width,
    actual.info.height,
  );
}

async function readRgba(path) {
  return sharp(path).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
}

function createShapeAccumulator() {
  return {
    count: 0,
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    sumX: 0,
    sumY: 0,
  };
}

function isCovered(pixels, offset) {
  return pixels[offset] + pixels[offset + 1] + pixels[offset + 2] > COVERAGE_RGB_SUM;
}

function accumulateShape(shape, covered, x, y) {
  if (!covered) {
    return;
  }
  shape.count += 1;
  shape.minX = Math.min(shape.minX, x);
  shape.minY = Math.min(shape.minY, y);
  shape.maxX = Math.max(shape.maxX, x);
  shape.maxY = Math.max(shape.maxY, y);
  shape.sumX += x;
  shape.sumY += y;
}

function finishShape(shape, width, height) {
  return {
    coveredPixelRatio: shape.count / (width * height),
    bounds:
      shape.count === 0
        ? null
        : [shape.minX, shape.minY, shape.maxX, shape.maxY],
    centroid:
      shape.count === 0
        ? null
        : [shape.sumX / shape.count, shape.sumY / shape.count],
  };
}

async function main() {
  const [actualPath, referencePath] = process.argv.slice(2);
  if (!actualPath || !referencePath) {
    throw new Error(
      "Usage: node scripts/compare-brush-images.mjs <actual.png> <reference.png>",
    );
  }
  console.log(JSON.stringify(await compareFiles(actualPath, referencePath), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
