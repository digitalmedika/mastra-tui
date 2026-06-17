#!/usr/bin/env node

declare const __PACKAGE_VERSION__: string;

const [, , ...args] = process.argv;

if (args.includes('-v') || args.includes('--version')) {
  console.log(__PACKAGE_VERSION__);
  process.exit(0);
}

if (args.includes('-h') || args.includes('--help')) {
  console.log(`Usage: loccle [options]

Options:
  -v, --version  Show version number
  -h, --help     Show this help message
`);
  process.exit(0);
}

await import('../src/tui/index');

export {};
