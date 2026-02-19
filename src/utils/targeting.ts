import semver from "semver";

export type AssignmentContext = {
  platform?: "ios" | "android";
  app_version?: string;
};

type TargetingRules = {
  platform?: string[] | string;
  min_app_version?: string;
  max_app_version?: string;
  [key: string]: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeVersion(version: string): string | null {
  const coerced = semver.coerce(version);
  return coerced ? coerced.version : null;
}

export function matchesTargeting(
  targeting: unknown,
  context: AssignmentContext,
): boolean {
  if (!targeting || !isObject(targeting)) {
    return true;
  }

  const rules = targeting as TargetingRules;

  if (rules.platform !== undefined) {
    const allowedPlatforms = Array.isArray(rules.platform)
      ? rules.platform.filter((value): value is string => typeof value === "string")
      : typeof rules.platform === "string"
        ? [rules.platform]
        : [];

    if (!context.platform || allowedPlatforms.length === 0) {
      return false;
    }

    if (!allowedPlatforms.includes(context.platform)) {
      return false;
    }
  }

  if (rules.min_app_version !== undefined) {
    if (typeof rules.min_app_version !== "string" || !context.app_version) {
      return false;
    }

    const currentVersion = normalizeVersion(context.app_version);
    const minVersion = normalizeVersion(rules.min_app_version);

    if (!currentVersion || !minVersion || semver.lt(currentVersion, minVersion)) {
      return false;
    }
  }

  if (rules.max_app_version !== undefined) {
    if (typeof rules.max_app_version !== "string" || !context.app_version) {
      return false;
    }

    const currentVersion = normalizeVersion(context.app_version);
    const maxVersion = normalizeVersion(rules.max_app_version);

    if (!currentVersion || !maxVersion || semver.gt(currentVersion, maxVersion)) {
      return false;
    }
  }

  return true;
}
