import { nativeTheme } from "electron";
import type { DesktopEnvironmentInfo } from "@shared/types";

export function detectDesktopEnvironment(): DesktopEnvironmentInfo {
  const raw = (process.env.XDG_CURRENT_DESKTOP ?? "").toLowerCase();
  let family: DesktopEnvironmentInfo["family"] = "other";
  if (raw.includes("gnome")) family = "gnome";
  else if (raw.includes("kde") || raw.includes("plasma")) family = "kde";
  return {
    raw,
    family,
    prefersDark: nativeTheme.shouldUseDarkColors
  };
}

export function onSystemThemeChange(cb: (prefersDark: boolean) => void): void {
  nativeTheme.on("updated", () => cb(nativeTheme.shouldUseDarkColors));
}
