import { chmod, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const outfile = resolve(root, 'dist/tui/cli.js');
const externalDependencies = Object.keys(packageJson.dependencies ?? {}).filter(
  (name) => name !== '@opentui/react',
);

await rm(resolve(root, 'dist/tui'), { force: true, recursive: true });
await mkdir(dirname(outfile), { recursive: true });

await build({
  entryPoints: {
    cli: resolve(root, 'bin/mastra-tui.ts'),
  },
  outdir: resolve(root, 'dist/tui'),
  bundle: true,
  splitting: true,
  external: externalDependencies,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  jsx: 'automatic',
  jsxImportSource: '@opentui/react',
  define: {
    __PACKAGE_VERSION__: JSON.stringify(packageJson.version),
  },
  logLevel: 'info',
});

await chmod(outfile, 0o755);
