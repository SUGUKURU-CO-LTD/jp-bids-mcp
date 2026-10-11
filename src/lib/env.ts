export function parsePositiveNumberEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`[warning] Numeric env var "${value}" is invalid. Falling back to ${fallback}.`);
    return fallback;
  }
  return parsed;
}

export function parsePortEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    console.error(
      `[warning] PORT="${value}" is not a valid TCP port. Falling back to ${fallback}.`,
    );
    return fallback;
  }
  return parsed;
}
