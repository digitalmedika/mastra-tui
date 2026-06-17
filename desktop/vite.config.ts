import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const outDir = 'dist-electron'

// Ensure dist-electron exists
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true })
}

// Copy preload.cjs as-is to dist-electron/preload.js
copyFileSync(
  path.resolve('electron/preload.cjs'),
  path.resolve(outDir, 'preload.js'),
)

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(args) {
          args.startup()
        },
        vite: {
          define: {
            'process.env.WS_NO_BUFFER_UTIL': JSON.stringify('true'),
            'process.env.WS_NO_UTF_8_VALIDATE': JSON.stringify('true'),
          },
          build: {
            outDir,
            rollupOptions: {
              external: (id) => id === 'electron' || id.startsWith('@libsql/'),
              output: {
                inlineDynamicImports: true,
              },
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../src'),
    },
  },
})
