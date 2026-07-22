import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@shared/constants";
import type { HyaecordBridge, HyaecordSettings } from "@shared/types";

const bridge: HyaecordBridge = {
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  setSettings: (patch: Partial<HyaecordSettings>) =>
    ipcRenderer.invoke(IPC.setSettings, patch),
  getDesktopEnvironment: () => ipcRenderer.invoke(IPC.getDesktopEnvironment),
  getLocaleStrings: () => ipcRenderer.invoke(IPC.getLocaleStrings),
  onThemeChanged: cb => {
    ipcRenderer.on(IPC.themeChanged, (_e, prefersDark: boolean) => cb(prefersDark));
  }
};

contextBridge.exposeInMainWorld("hyaecord", bridge);
