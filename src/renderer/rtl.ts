/**
 * RTL scaffolding — no RTL translation exists yet (only en.json), but the
 * base layout needs to already work correctly if/when one ships, rather
 * than needing a retrofit. `<html dir>`/`lang` are set from the resolved
 * locale on every launch; `styles.css` has matching `[dir="rtl"]`
 * overrides for the shell's physical (not logical-property) layout, the
 * one part a locale switch can't fix on its own.
 */

// ISO 639-1 codes for scripts conventionally written right-to-left.
const RTL_LOCALES = new Set(["ar", "he", "fa", "ur", "yi", "dv", "ps", "sd"]);

export function isRtlLocale(locale: string): boolean {
  return RTL_LOCALES.has(locale.toLowerCase());
}

export function applyDirection(locale: string): void {
  const rtl = isRtlLocale(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = rtl ? "rtl" : "ltr";
}
