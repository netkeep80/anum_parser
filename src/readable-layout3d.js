import {
  physicalPotentialEnergy3d,
  solvePhysicalLayout3d,
} from "./physics3d.js";
import { optimizeReadability3d } from "./readability3d.js";

export function solveReadableLayout3d(visualModel, options = {}) {
  const physicsOptions = options.physics ?? options;
  const readabilityOptions = options.readability ?? {};
  const physicalState = solvePhysicalLayout3d(visualModel, physicsOptions);
  const energyEvaluator = (positions) => physicalPotentialEnergy3d(
    physicalState.physicalModel,
    positions,
    physicalState.options,
  );
  const readability = optimizeReadability3d({
    positions: physicalState.positions,
    rootId: physicalState.physicalModel.rootId,
    energyEvaluator,
  }, readabilityOptions);

  return {
    ...physicalState,
    positions: readability.positions,
    readability,
    metrics: {
      ...physicalState.metrics,
      readability: readability.metrics,
    },
  };
}
