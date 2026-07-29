export function copyUv1BirthTimes(
  source: ArrayLike<number>,
  sourceItemSize: number,
  target: Float32Array,
  vertexCount: number,
): void {
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    target[vertex] = source[vertex * sourceItemSize + 3] ?? 0;
  }
}
