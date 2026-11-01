import path from 'node:path';
import { BRAND, envVar } from '@shared/brand';
import { app, BrowserWindow, nativeTheme } from 'electron';

/** The app icon for unpackaged runs, where no bundle supplies it (dev Dock, Linux window). */
export const devIconPath = () => path.join(app.getAppPath(), 'build', 'icons', '512x512.png');

/** Linux: the icon for the window and notifications; packaged builds carry it in resources. */
export const linuxIconPath = () =>
  app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : devIconPath();

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: BRAND.displayName,
    // The theme's --color-chrome, so the window doesn't flash before the page paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0e11' : '#e4e6ea',
    // macOS: the profile tab strip is the title bar, with the traffic lights in it.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 13 } }
      : {}),
    ...(process.platform === 'linux' ? { icon: linuxIconPath() } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      preload: path.join(__dirname, '../preload/index.js'),
    },
  });

  // Scripted tests run the window in the background: shown without taking focus,
  // transparent and letting the mouse through, so it never catches the keys or
  // clicks of someone using the machine (scripts/lib/app-driver.ts).
  const background = process.env[envVar('TEST_WINDOW')] === 'background';
  win.once('ready-to-show', () => {
    if (!background) {
      win.show();
      return;
    }
    win.setOpacity(0);
    win.setIgnoreMouseEvents(true);
    win.showInactive();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
  return win;
}
