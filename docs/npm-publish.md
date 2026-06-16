# Publish to npm

Use this checklist when publishing `loccle` again.

## Prerequisites

- Make sure you are logged in to npm:

```shell
npm whoami
```

- Never commit an npm token. If a token is needed, pass it only through a temporary shell environment or login interactively.
- Use the project scripts from `package.json`. For Mastra builds, run `bun run build`, not `mastra build` directly.

## Release checklist

1. Check the latest published version:

```shell
npm view loccle version dist-tags bin --json
```

2. Bump `package.json` to the next patch/minor/major version.

Example: if npm shows `1.0.16`, publish the next patch as `1.0.17`.

3. Confirm production backend defaults.

The CLI should work without a local `.env`. The code defaults to:

```text
https://api.loccle.com
```

`AUTH_SERVER_URL` is only for local development or staging override.

4. Build:

```shell
bun run build
```

5. Preview the package contents:

```shell
npm pack --dry-run
```

Confirm the tarball does not include secrets, `.env`, `.mastra`, local caches, or runtime database files.

6. Publish:

```shell
npm publish --access public
```

7. Verify npm registry metadata:

```shell
npm view loccle version dist-tags bin --json
```

Confirm `latest` points to the new version and `bin` includes `loccle`.

## Expected package shape

`package.json` should keep:

```json
{
  "name": "loccle",
  "bin": {
    "loccle": "bin/mastra-tui.ts",
    "mastra-tui": "bin/mastra-tui.ts"
  },
  "files": [
    "bin/**/*",
    "src/**/*.ts",
    "src/**/*.tsx",
    "index.ts",
    "tsconfig.json",
    "README.md"
  ]
}
```

If npm prints a warning about normalizing `bin` paths, run:

```shell
npm pkg fix
```

Then re-check with:

```shell
npm pack --dry-run
```

## Windows cache note

If npm fails with a cache permission error on Windows, use a temporary cache inside the project:

```powershell
$env:npm_config_cache='D:\project\mastra-tui\.npm-cache'
npm pack --dry-run
npm publish --access public
```

Delete `.npm-cache` after publishing. It should not be committed.
