import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Stoat session-token storage — same encrypted-at-rest approach as
 * discord/token-store.ts (OS keyring via Electron safeStorage), just a
 * separate file so a Discord and a Stoat account can be connected at the
 * same time without clobbering each other's stored credential.
 */

function tokenPath(): string {
  return join(app.getPath("userData"), "stoat-token.bin");
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

export function setToken(token: string): boolean {
  sessionToken = token;
  if (!safeStorage.isEncryptionAvailable()) return false;
  const path = tokenPath();
  const tmp = path + ".tmp";
  writeFileSync(tmp, safeStorage.encryptString(token), { mode: 0o600 });
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
