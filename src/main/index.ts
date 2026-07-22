import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { IPC, PRODUCT_NAME } from "@shared/constants";
import type { HyaecordSettings } from "@shared/types";
import { loadSettings, saveSettings } from "./settings";
import { detectDesktopEnvironment, onSystemThemeChange } from "./theme";
import { getLocaleStrings } from "./i18n";
import { createTray } from "./tray";

let mainWindow: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    icon: join(app.getAppPath(), "assets", "icons", "hyaecord-256.png"),
    backgroundColor: "#16130e",
    show: false,
    webPreferences: {
      preload: join(app.getAppPath(), "dist", "preload", "index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.loadFile(join(app.getAppPath(), "dist", "renderer", "index.html"));
  mainWindow.on("closed", () => (mainWindow = null));
}

app.whenReady().then(() => {
  ipcMain.handle(IPC.getSettings, () => loadSettings());
  ipcMain.handle(IPC.setSettings, (_e, patch: Partial<HyaecordSettings>) =>
    saveSettings(patch)
  );
  ipcMain.handle(IPC.getDesktopEnvironment, () => detectDesktopEnvironment());
  ipcMain.handle(IPC.getLocaleStrings, () => getLocaleStrings());

  createWindow();
  if (mainWindow) createTray(mainWindow);

  onSystemThemeChange(prefersDark => {
    mainWindow?.webContents.send(IPC.themeChanged, prefersDark);
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Keep running in the tray on Linux/Windows; quitting is explicit via tray menu.
});
