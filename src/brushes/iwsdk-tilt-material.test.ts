import { ShaderMaterial } from "@iwsdk/core";
import { describe, expect, it, vi } from "vitest";
import { TiltShaderLoader } from "three-icosa";

import { createIwsdkTiltMaterial } from "./iwsdk-tilt-material.js";

vi.mock("@iwsdk/core", () => ({
  ShaderMaterial: class {
    type = "ShaderMaterial";
    index0AttributeName?: string;
    name: string;
    vertexShader: string;
    fragmentShader: string;

    constructor(params: {
      name?: string;
      vertexShader?: string;
      fragmentShader?: string;
      [key: string]: unknown;
    }) {
      Object.assign(this, params);
      this.name = params.name ?? "";
      this.vertexShader = params.vertexShader ?? "";
      this.fragmentShader = params.fragmentShader ?? "";
    }
  },
}));

describe("IWSDK three-icosa material adapter", () => {
  it("creates a non-raw XR-compatible material through the upstream loader", () => {
    const loader = new TiltShaderLoader(undefined, {
      materialFactory: createIwsdkTiltMaterial,
    });

    const material = loader.createMaterial(
      {
        vertexShader:
          "uniform mat4 modelViewMatrix; attribute vec4 a_position; void main() { gl_Position = modelViewMatrix * a_position; }",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      },
      "OilPaint",
    );

    expect(material).toBeInstanceOf(ShaderMaterial);
    expect(material.type).toBe("ShaderMaterial");
    expect(material.name).toBe("OpenBrushShader_OilPaint");
    expect((material as ShaderMaterial).index0AttributeName).toBe("a_position");
    expect((material as ShaderMaterial).vertexShader).not.toContain(
      "uniform mat4 modelViewMatrix",
    );
  });

  it("preserves trusted texture uniforms and render state", () => {
    const uniforms = {
      u_MainTex_ST: { value: { x: 0.5, y: 1, z: 0, w: 0 } },
      u_SecondaryTex_ST: { value: { x: 0.3, y: 0.5, z: 0, w: 0 } },
    };
    const material = createIwsdkTiltMaterial(
      {
        uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: 2,
        blending: 5,
        blendSrc: 201,
        blendDst: 202,
        blendEquation: 100,
        vertexShader: "void main() { gl_Position = vec4(0.0); }",
        fragmentShader: "void main() { gl_FragColor = vec4(1.0); }",
      },
      "LeakyPen",
    );

    expect(material.uniforms).toBe(uniforms);
    expect(material).toMatchObject({
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: 2,
      blending: 5,
      blendSrc: 201,
      blendDst: 202,
      blendEquation: 100,
    });
  });
});
