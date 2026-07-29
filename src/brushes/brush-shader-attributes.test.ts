import { describe, expect, it } from "vitest";

import { copyUv1BirthTimes } from "./brush-shader-attributes.js";

describe("brush shader supplemental attributes", () => {
  it("extracts Dance Floor birth time from uv1.w as a scalar timestamp", () => {
    const target = new Float32Array(3);
    copyUv1BirthTimes(
      new Float32Array([
        1, 2, 3, 0.25,
        4, 5, 6, 0.5,
        7, 8, 9, 0.75,
      ]),
      4,
      target,
      3,
    );

    expect(Array.from(target)).toEqual([0.25, 0.5, 0.75]);
  });

  it("only updates the used vertex range", () => {
    const target = new Float32Array([9, 9, 9]);
    copyUv1BirthTimes(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3]),
      4,
      target,
      2,
    );
    expect(Array.from(target)).toEqual([1, 2, 9]);
  });
});
