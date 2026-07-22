import { app, Menu, nativeImage, Tray, type BrowserWindow } from "electron";
import { join } from "node:path";
import { PRODUCT_NAME } from "@shared/constants";

let tray: Tray | null = null;

export function createTray(win: BrowserWindow): Tray {
  const icon = nativeImage.createFromPath(
    join(app.getAppPath(), "assets", "icons", "hyaecord-64.png")
  );
  tray = new Tray(icon);
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${PRODUCT_NAME}`, click: () => win.show() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
  tray.on("click", () => (win.isVisible() ? win.hide() : win.show()));
  return tray;
}
