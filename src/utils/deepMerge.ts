export type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result: JsonObject = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (Array.isArray(value)) {
      result[key] = value.slice();
      continue;
    }

    if (isPlainObject(value)) {
      const current = result[key];
      result[key] = isPlainObject(current)
        ? deepMerge(current, value)
        : deepMerge({}, value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

export function toJsonObject(value: unknown): JsonObject {
  return isPlainObject(value) ? value : {};
}
