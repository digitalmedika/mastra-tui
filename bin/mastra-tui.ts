#!/usr/bin/env bun

const [, , ...args] = process.argv;

if (args.includes('-v') || args.includes('--version')) {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  console.log(pkg.default.version);
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
