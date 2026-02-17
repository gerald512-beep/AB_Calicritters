export function getBucketFromAnonymousId(
  anonymousUserId: string,
  variantCount: number,
): number {
  const normalized = anonymousUserId.toLowerCase().replace(/-/g, "");
  const chars = normalized.split("");
  const lastHex = [...chars].reverse().find((ch) => /[0-9a-f]/.test(ch));

  if (lastHex) {
    return Number.parseInt(lastHex, 16) % variantCount;
  }

  const fallback = chars.reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return fallback % variantCount;
}
