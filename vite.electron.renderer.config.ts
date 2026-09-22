import { readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/**
 * `public/` is shared with the hosted build, and two of its files belong only
 * to the web:
 *
 *  * `_headers` is a Cloudflare directive file — the CSP and the
 *    Permissions-Policy the site is served with. It means nothing over
 *    `app://`, where the CSP is a meta tag in the renderer's own HTML and the
 *    camera policy is the main process's permission handler. Left in, it is a
 *    second, stale-looking copy of the security posture for someone to read
 *    and believe.
 *  * `support-footer.js` is the site's footer, which this renderer's HTML does
 *    not load. It would be the only file in an offline app that wanted the
 *    network.
 */
const WEB_ONLY = ['_headers', 'support-footer.js']

function dropWebOnlyAssets(): Plugin {
  return {
    name: 'peephole-drop-web-only-assets',
    writeBundle(options) {
      if (!options.dir) return
      for (const name of WEB_ONLY) rmSync(join(options.dir, name), { force: true })
    },
  }
}

/**
 * The desktop renderer: the same React app the hosted site serves, from the
 * same `src/`, with its own index.html (no canonical/OG tags, no support
 * footer, and a CSP written for `app://` rather than for Cloudflare).
 *
 * There is no dev-server variant of this config, deliberately. The UI is
 * iterated in a browser with `npm run dev`; the desktop shell has exactly one
 * code path — built assets over `app://`, with the network blocked — so there
 * is no second configuration in which the app behaves differently from the one
 * that ships.
 */
export default defineConfig({
  root: resolve('electron/renderer'),
  // Shared with the hosted build so the About dialog's vendored files live in
  // exactly one place.
  publicDir: resolve('public'),
  base: './',
  define: { __APP_VERSION__: JSON.stringify(`v${pkg.version}`) },
  plugins: [react(), dropWebOnlyAssets()],
  build: {
    outDir: resolve('out/renderer'),
    emptyOutDir: true,
    sourcemap: true,
  },
})
