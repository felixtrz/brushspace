export interface BrushMaterialUpgradeTarget<TMaterial> {
  brushGuid: string;
  material: TMaterial;
}

export interface BrushMaterialUpgrade<TTarget, TMaterial> {
  target: TTarget;
  previous: TMaterial;
  next: TMaterial;
}

export function planBrushMaterialUpgrades<
  TTarget extends BrushMaterialUpgradeTarget<TMaterial>,
  TMaterial,
>(
  targets: readonly TTarget[],
  loadedGuid: string,
  loadedMaterial: TMaterial,
): Array<BrushMaterialUpgrade<TTarget, TMaterial>> {
  const normalizedGuid = loadedGuid.toLowerCase();
  const upgrades: Array<BrushMaterialUpgrade<TTarget, TMaterial>> = [];
  for (const target of targets) {
    if (
      target.brushGuid.toLowerCase() === normalizedGuid &&
      target.material !== loadedMaterial
    ) {
      upgrades.push({
        target,
        previous: target.material,
        next: loadedMaterial,
      });
    }
  }
  return upgrades;
}
