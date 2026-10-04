import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

// Bundles the Electron main process and its dependencies into one file, so the installer ships no node_modules.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'electron/main.ts',
    outDir: 'dist-electron',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      external: ['electron', /^node:/, ...builtinModules],
      output: { format: 'cjs', entryFileNames: 'main.cjs' },
    },
  },
  ssr: { noExternal: true, external: ['electron'] },
})
