import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

// Resolve local TypeDoc CLI entrypoint without external npx resolution
const require = createRequire(import.meta.url);
let typedocBin;
try {
  const typedocPkgPath = require.resolve("typedoc/package.json");
  typedocBin = resolve(dirname(typedocPkgPath), "bin/typedoc");
} catch (err) {
  console.error("[generate-docs] Failed to resolve typedoc package:", err);
  process.exit(1);
}

if (!existsSync(typedocBin)) {
  console.error(`[generate-docs] TypeDoc binary not found at ${typedocBin}`);
  process.exit(1);
}

// Preserve LC_ALL / LANG for reproducible documentation output
const env = {
  ...process.env,
  LC_ALL: "ja_JP.UTF-8",
  LANG: "ja_JP.UTF-8",
};

// Allow testing failure paths when requested
if (process.env.TYPEDOC_TEST_FAIL_LAUNCH === "1") {
  typedocBin = resolve(dirname(typedocBin), "non-existent-binary");
}

const args = [typedocBin, ...process.argv.slice(2)];
const result = spawnSync(process.execPath, args, {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error("[generate-docs] Subprocess launch error:", result.error.message);
  process.exit(1);
}

if (typeof result.status !== "number" || result.status !== 0) {
  const exitCode = typeof result.status === "number" ? result.status : 1;
  console.error(`[generate-docs] TypeDoc process terminated with exit code ${exitCode}`);
  process.exit(exitCode);
}
