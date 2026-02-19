import { createHash } from "crypto";

export function hashToUnitInterval(input: string): number {
  const digest = createHash("sha256").update(input).digest();
  const value = digest.readUInt32BE(0);
  return value / 2 ** 32;
}
