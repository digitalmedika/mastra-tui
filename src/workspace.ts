import fs from 'node:fs';
import path from 'node:path';

export function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = startDir;

  while (true) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return startDir;
    }

    dir = parent;
  }
}

export const defaultWorkspacePath = process.env.VIBE_CODING_WORKSPACE_PATH?.trim() || findProjectRoot();
