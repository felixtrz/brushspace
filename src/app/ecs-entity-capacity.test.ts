import { describe, expect, it } from "vitest";
import { World, createComponent, Types } from "elics";

import {
  DEFAULT_ENTITY_CAPACITY,
  raiseEcsEntityCapacity,
} from "./ecs-entity-capacity.js";

let componentCounter = 0;

function makeComponent() {
  componentCounter += 1;
  return createComponent(`CapacityTestComponent${componentCounter}`, {
    value: { type: Types.Float32, default: 0 },
    triple: { type: Types.Vec3, default: [0, 0, 0] },
  });
}

describe("raiseEcsEntityCapacity", () => {
  it("sizes component storage above the elics default of 1000", () => {
    raiseEcsEntityCapacity();
    const world = new World();
    const component = makeComponent();
    world.registerComponent(component);
    expect((component.data.value as Float32Array).length).toBe(
      DEFAULT_ENTITY_CAPACITY,
    );
    expect((component.data.triple as Float32Array).length).toBe(
      DEFAULT_ENTITY_CAPACITY * 3,
    );
  });

  it("lets more than 1000 entities carry a component (the stroke-950 crash)", () => {
    raiseEcsEntityCapacity();
    const world = new World();
    const component = makeComponent();
    world.registerComponent(component);
    const count = 3000;
    const entities = [];
    for (let index = 0; index < count; index += 1) {
      const entity = world.createEntity();
      entity.addComponent(component, { value: index, triple: [index, 0, 1] });
      entities.push(entity);
    }
    const last = entities[count - 1];
    expect(Number(last.getValue(component, "value"))).toBe(count - 1);
    const view = last.getVectorView(component, "triple");
    expect(Array.from(view)).toEqual([count - 1, 0, 1]);
  });

  it("is idempotent and keeps the largest capacity requested", () => {
    raiseEcsEntityCapacity(2000);
    raiseEcsEntityCapacity(4096);
    raiseEcsEntityCapacity(64); // must not shrink
    const world = new World();
    const component = makeComponent();
    world.registerComponent(component);
    expect(
      (component.data.value as Float32Array).length,
    ).toBeGreaterThanOrEqual(4096);
  });
});
