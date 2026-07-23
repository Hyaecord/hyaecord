import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

/**
 * Loads a local, git-ignored `.env` file (repo root in dev, next to the
 * packaged app in production) into `process.env` — deliberately no
 * `dotenv` dependency for a one-line KEY=value parser. This exists so a
 * personal API key (e.g. Giphy) never has to be committed to this public
 * repo: it lives only in a local `.env` file the owner creates themselves
 * (see `.env.example`), and the app silently runs without that feature if
 * the file/key is absent.
 */
export function loadEnvFile(): void {
  const candidates = [join(app.getAppPath(), ".env"), join(app.getAppPath(), "..", ".env")];
  for (const path of candidates) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !(key in process.env)) process.env[key] = value;
    }
    return;
  }
}
