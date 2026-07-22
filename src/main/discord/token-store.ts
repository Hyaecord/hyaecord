import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Discord token storage. The token is encrypted with the OS keyring via
 * Electron safeStorage (Secret Service/kwallet on Linux, DPAPI on Windows).
 * If no OS-level encryption is available we refuse to persist and the session
 * lasts only until quit — never write the token to disk in plaintext.
 */

function tokenPath(): string {
  return join(app.getPath("userData"), "token.bin");
}

let sessionToken: string | null = null;

export function getToken(): string | null {
  if (sessionToken) return sessionToken;
  try {
    const encrypted = readFileSync(tokenPath());
    sessionToken = safeStorage.decryptString(encrypted);
  } catch {
    sessionToken = null;
  }
  return sessionToken;
}

/** Returns true if the token could be persisted (vs. session-only). */
export function setToken(token: string): boolean {
  sessionToken = token;
  if (!safeStorage.isEncryptionAvailable()) return false;
  const path = tokenPath();
  const tmp = path + ".tmp";
  writeFileSync(tmp, safeStorage.encryptString(token));
  renameSync(tmp, path);
  return true;
}

export function clearToken(): void {
  sessionToken = null;
  try {
    rmSync(tokenPath());
  } catch {
    // already gone
  }
}
