import { selectWeightedVariant } from "../utils/weightedBucket";

const variants = [
  { variant_id: "A", weight: 0.34 },
  { variant_id: "B", weight: 0.33 },
  { variant_id: "C", weight: 0.33 },
];

const stableKey = "550e8400-e29b-41d4-a716-446655440000:exp_3_landing_journey";
const first = selectWeightedVariant(stableKey, variants).variant_id;

for (let i = 0; i < 100; i += 1) {
  const current = selectWeightedVariant(stableKey, variants).variant_id;
  if (current !== first) {
    throw new Error(`Determinism check failed: expected ${first}, got ${current}`);
  }
}

console.log(`Determinism check passed. Variant=${first}`);
