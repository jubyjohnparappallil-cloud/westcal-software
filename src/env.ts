import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = join(dirname(fileURLToPath(import.meta.url)), "..", ".env");
const loader = (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile;

if (existsSync(envFile)) {
  if (loader) loader(envFile);
  else console.warn(".env found but this Node version cannot load it. Use Node 20.12+ or set the variables in the shell.");
}
