import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { RequestContext } from '@mastra/core/request-context';

const expandHomePath = (inputPath: string) => {
  if (inputPath === '~') {
    return os.homedir();
  }

  if (inputPath.startsWith('~/')) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
};

export const normalizeWorkspacePath = (inputPath: string) => {
  return path.resolve(expandHomePath(inputPath.trim()));
};

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

export const workspacePathKey = 'mastra-tui.workspacePath';

export function resolveDefaultWorkspacePath(): string {
  const configuredWorkspacePath = process.env.VIBE_CODING_WORKSPACE_PATH?.trim();
  const packageRunnerCwd = process.env.INIT_CWD?.trim();
  return normalizeWorkspacePath(configuredWorkspacePath || packageRunnerCwd || process.cwd());
}

export const defaultWorkspacePath = resolveDefaultWorkspacePath();

export const allowedExternalWorkspacePathsKey = 'mastra-tui.allowedExternalWorkspacePaths';

const allowedPathsBySession = new Map<string, Set<string>>();

export function getRequestWorkspacePath(requestContext: RequestContext | undefined): string {
  if (!requestContext) {
    return defaultWorkspacePath;
  }

  const requestWorkspacePath = requestContext.get<typeof workspacePathKey, string>(workspacePathKey);
  return typeof requestWorkspacePath === 'string' && requestWorkspacePath.trim()
    ? normalizeWorkspacePath(requestWorkspacePath)
    : defaultWorkspacePath;
}

export function isPathWithinRoot(inputPath: string, rootPath: string): boolean {
  const normalizedPath = normalizeWorkspacePath(inputPath);
  const normalizedRoot = normalizeWorkspacePath(rootPath);
  const relativePath = path.relative(normalizedRoot, normalizedPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export function isPathWithinAllowedRoots(inputPath: string, rootPaths: string[]): boolean {
  return rootPaths.some((rootPath) => isPathWithinRoot(inputPath, rootPath));
}

export function allowExternalWorkspacePath(sessionId: string, inputPath: string): string {
  const normalized = normalizeWorkspacePath(inputPath);
  const allowedPaths = allowedPathsBySession.get(sessionId) ?? new Set<string>();
  allowedPaths.add(normalized);
  allowedPathsBySession.set(sessionId, allowedPaths);
  return normalized;
}

export function getAllowedExternalWorkspacePaths(sessionId: string): string[] {
  return [...(allowedPathsBySession.get(sessionId) ?? [])];
}

export function getRequestAllowedExternalWorkspacePaths(requestContext: RequestContext | undefined): string[] {
  if (!requestContext) {
    return [];
  }

  const allowedPaths = requestContext.get<typeof allowedExternalWorkspacePathsKey, string[]>(allowedExternalWorkspacePathsKey);
  return Array.isArray(allowedPaths) ? allowedPaths.filter((item) => typeof item === 'string' && item.trim()) : [];
}
