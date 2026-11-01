import { app, session, shell, type WebContents } from 'electron';

/** Opens a URL in the user's browser, but only for http and https. */
export function openExternalSafe(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return;
  }
  if (protocol === 'http:' || protocol === 'https:') {
    void shell.openExternal(url);
  }
}

function harden(contents: WebContents): void {
  // The UI is a single page; it never navigates. Reloads don't emit will-navigate.
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
}

/** App-wide renderer restrictions. Call before any window is created. */
export function installSecurityPolicies(): void {
  app.on('web-contents-created', (_event, contents) => harden(contents));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
}
