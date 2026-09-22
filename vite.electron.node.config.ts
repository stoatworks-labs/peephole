import { builtinModules } from 'node:module'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Electron's main and preload processes.
 *
 * Built as CommonJS on purpose. package.json carries `"type": "module"` for the
 * web build, so a plain `.js` emitted here would be loaded as ESM — and an ESM
 * preload only works with `sandbox: false`, while an ESM main has to be named
 * `.mjs`. Emitting `.cjs` sidesteps both questions and keeps `__dirname`, which
 * is how the main process finds the built renderer next to itself in the asar.
 *
 * Nothing is bundled from node_modules because nothing needs to be: the app has
 * no runtime dependencies at all (React is a build-time input to the renderer
 * bundle, in both this shape and the hosted one), so `electron` and the Node
 * built-ins are the entire external list.
 */
const external = ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)]

export default defineConfig({
  // Vite would otherwise copy `public/` into out/, because this config's root
  // is the repo root. The renderer build is what owns those files; a second
  // copy beside the compiled main process is nothing but confusion.
  publicDir: false,
  build: {
    outDir: 'out',
    // Runs before the renderer build, which writes out/renderer — see the
    // electron:build script. Reversing those two would delete the renderer.
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    sourcemap: true,
    lib: {
      entry: {
        'main/index': resolve('electron/main/index.ts'),
        'preload/index': resolve('electron/preload/index.ts'),
      },
      formats: ['cjs'],
      fileName: (_format, name) => `${name}.cjs`,
    },
    rollupOptions: { external },
  },
})
