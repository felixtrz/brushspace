import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("generated brush shader assets", () => {
  it("defines the additive emission macro whenever the template consumes it", () => {
    const shaderDirectory = path.resolve("public/openbrush/shaders");
    const missingDefines = fs
      .readdirSync(shaderDirectory)
      .filter((file) => file.endsWith("-fragment.glsl"))
      .filter((file) => {
        const source = fs.readFileSync(path.join(shaderDirectory, file), "utf8");
        return (
          source.includes("TB_EMISSION_GAIN") &&
          !/^#define TB_EMISSION_GAIN /m.test(source)
        );
      });

    expect(missingDefines).toEqual([]);
  });
});
