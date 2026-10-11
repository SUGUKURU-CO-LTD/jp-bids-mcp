// Server Profile Definition & Environment Validation
// Defines public_mvp (default, free, 7 tools) vs full_local (all tools, local dev only)

import { UserInputError } from "./errors.js";

export type ServerProfile = "public_mvp" | "full_local";

export const PUBLIC_MVP_PROFILE: ServerProfile = "public_mvp";
export const FULL_LOCAL_PROFILE: ServerProfile = "full_local";

/**
 * Returns true if running in a production environment (Cloud Run / K_SERVICE or NODE_ENV / JP_BIDS_ENV = production).
 */
export function isProductionEnvironment(): boolean {
  return Boolean(
    process.env.K_SERVICE ||
      process.env.NODE_ENV === "production" ||
      process.env.JP_BIDS_ENV === "production",
  );
}

/**
 * Resolves the server profile from explicit parameter or JP_BIDS_PROFILE env var.
 * Defaults to "public_mvp". Throws if given an invalid value or if "full_local" is used in production.
 */
export function resolveServerProfile(explicit?: string): ServerProfile {
  const raw = explicit ?? process.env.JP_BIDS_PROFILE;
  if (!raw || raw.trim() === "") {
    return PUBLIC_MVP_PROFILE;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "public_mvp") {
    return PUBLIC_MVP_PROFILE;
  }
  if (normalized === "full_local") {
    assertValidProfile(FULL_LOCAL_PROFILE);
    return FULL_LOCAL_PROFILE;
  }
  throw new UserInputError(
    `Invalid server profile: "${raw}". Allowed profiles are "public_mvp" and "full_local".`,
  );
}

/**
 * Asserts that the given profile is allowed in the current runtime environment.
 * "full_local" is strictly prohibited in production.
 */
export function assertValidProfile(profile: ServerProfile): void {
  if (profile !== PUBLIC_MVP_PROFILE && profile !== FULL_LOCAL_PROFILE) {
    throw new UserInputError(
      `Invalid server profile: "${profile}". Allowed profiles are "public_mvp" and "full_local".`,
    );
  }
  if (profile === FULL_LOCAL_PROFILE && isProductionEnvironment()) {
    throw new UserInputError(
      "The full_local profile is strictly forbidden in production environments (K_SERVICE / NODE_ENV / JP_BIDS_ENV=production). Use public_mvp instead.",
    );
  }
}

/**
 * Gets the currently active server profile.
 */
export function getActiveProfile(): ServerProfile {
  return resolveServerProfile();
}

/**
 * Helper for test isolation to set or clear the JP_BIDS_PROFILE environment variable.
 */
export function setTestProfile(profile: ServerProfile | undefined): void {
  if (profile === undefined) {
    delete process.env.JP_BIDS_PROFILE;
  } else {
    process.env.JP_BIDS_PROFILE = profile;
  }
}
