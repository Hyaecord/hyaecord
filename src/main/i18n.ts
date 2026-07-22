import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

const FALLBACK_LOCALE = "en";

function localeDir(): string {
  // i18n bundles are copied next to the compiled main process output.
  return join(app.getAppPath(), "dist", "i18n");
}

function readLocale(locale: string): Record<string, string> | null {
  try {
    return JSON.parse(readFileSync(join(localeDir(), `${locale}.json`), "utf8"));
  } catch {
    return null;
  }
}

/** Returns the user's locale strings merged over the English fallback. */
export function getLocaleStrings(): Record<string, string> {
  const fallback = readLocale(FALLBACK_LOCALE) ?? {};
  const locale = app.getLocale().split("-")[0] ?? FALLBACK_LOCALE;
  if (locale === FALLBACK_LOCALE) return fallback;
  return { ...fallback, ...(readLocale(locale) ?? {}) };
}
