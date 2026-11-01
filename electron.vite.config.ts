import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const alias = { '@shared': resolve(__dirname, 'src/shared') };

/**
 * The React refresh preamble that Vite injects in dev is an inline script, so
 * the dev server relaxes script-src. Production builds keep the strict CSP.
 */
function devCsp(): Plugin {
  return {
    name: 'dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) =>
      html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: {
      alias: {
        ...alias,
        // Monaco's icon font (the diff's +/− signs); its ESM editor API doesn't load it.
        'monaco-codicon.css': resolve(
          __dirname,
          'node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css',
        ),
      },
    },
    plugins: [react(), tailwindcss(), devCsp()],
  },
});
