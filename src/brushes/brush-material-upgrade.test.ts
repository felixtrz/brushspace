import { describe, expect, it } from "vitest";

import { planBrushMaterialUpgrades } from "./brush-material-upgrade.js";

describe("late brush material upgrades", () => {
  it("upgrades only matching strokes that still use another material", () => {
    const fallback = { name: "fallback" };
    const loaded = { name: "loaded" };
    const matching = { brushGuid: "ABC", material: fallback };
    const current = { brushGuid: "abc", material: loaded };
    const other = { brushGuid: "def", material: fallback };

    expect(
      planBrushMaterialUpgrades([matching, current, other], "abc", loaded),
    ).toEqual([{ target: matching, previous: fallback, next: loaded }]);
  });
});
