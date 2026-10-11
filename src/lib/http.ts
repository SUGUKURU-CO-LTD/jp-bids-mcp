import type { NextFunction, Request, Response } from "express";

export function validateOrigin(allowedOrigins: ReadonlySet<string>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const origin = req.header("origin");
    if (!origin || allowedOrigins.size === 0 || allowedOrigins.has(origin)) {
      next();
      return;
    }
    res.status(403).json({ error: "Origin is not allowed" });
  };
}

export function parseAllowedOrigins(value: string | undefined): ReadonlySet<string> {
  if (!value) {
    return new Set();
  }
  return new Set(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  );
}
