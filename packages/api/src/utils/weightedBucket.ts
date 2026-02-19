import { hashToUnitInterval } from "./hash";

export interface WeightedVariant {
  variant_id: string;
  weight: number;
}

export function selectWeightedVariant<T extends WeightedVariant>(
  stableKey: string,
  variants: T[],
): T {
  const ordered = [...variants].sort((a, b) => a.variant_id.localeCompare(b.variant_id));
  const totalWeight = ordered.reduce(
    (sum, variant) => sum + (variant.weight > 0 ? variant.weight : 0),
    0,
  );

  if (ordered.length === 0 || totalWeight <= 0) {
    throw new Error("No valid variants available for weighted assignment.");
  }

  const point = hashToUnitInterval(stableKey) * totalWeight;
  let cumulative = 0;

  for (const variant of ordered) {
    cumulative += variant.weight > 0 ? variant.weight : 0;
    if (point < cumulative) {
      return variant;
    }
  }

  return ordered[ordered.length - 1];
}
