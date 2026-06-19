import fs from 'node:fs';
import path from 'node:path';
import { Agent } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { WrappedTaskSignalProvider } from './wrapped-task-signal';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { getStoredSession } from '../../tui/auth/storage';
import { findProjectRoot, getRequestAllowedExternalWorkspacePaths, getRequestWorkspacePath } from '../../workspace';
import { readManyFiles } from '../tools/read-many-files-tool';

const projectRoot = findProjectRoot();

const providerId = process.env.OPENAI_COMPATIBLE_PROVIDER_ID ?? 'custom';
const authServerUrl = process.env.AUTH_SERVER_URL ?? 'https://api.loccle.com';
const explicitBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
const baseUrl = explicitBaseUrl || `${authServerUrl}/v1`;
const envApiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
const defaultMemoryPath = path.join(projectRoot, '.loccle', 'memory.db');
fs.mkdirSync(path.dirname(defaultMemoryPath), { recursive: true });
const memoryUrl = process.env.OPENAI_COMPATIBLE_MEMORY_URL ?? `file:${defaultMemoryPath.replace(/\\/g, '/')}`;

// Mutable model ID, initialized from env and refreshable at runtime.
let currentModelId = process.env.OPENAI_COMPATIBLE_MODEL?.trim() || 'gpt-4o-mini';

function getApiKey(): string {
  if (explicitBaseUrl) return envApiKey;
  return getStoredSession()?.token ?? envApiKey;
}

function buildModelConfig(): OpenAICompatibleConfig {
  return {
    providerId,
    modelId: currentModelId,
    url: baseUrl,
    apiKey: getApiKey(),
  };
}

const vibeCodingWorkspace = new Workspace({
  id: 'vibe-coding-workspace',
  name: 'Vibe Coding Workspace',
  filesystem: ({ requestContext }) => {
    const workspacePath = getRequestWorkspacePath(requestContext);
    return new LocalFilesystem({
      basePath: workspacePath,
      allowedPaths: getRequestAllowedExternalWorkspacePaths(requestContext),
    });
  },
  sandbox: ({ requestContext }) => new LocalSandbox({
    workingDirectory: getRequestWorkspacePath(requestContext),
  }),
  sandboxCacheKey: ({ requestContext }) => getRequestWorkspacePath(requestContext),
  instructions: {
    dynamicSandbox: ({ requestContext }) =>
      `Local command execution. Working directory: "${getRequestWorkspacePath(requestContext)}".`,
  },
});

const instructions = `You are a vibe coding assistant: a collaborative software partner who helps users turn rough ideas into working code through fast, thoughtful iteration.

# How to Work on Tasks

## Start by Understanding
- Read relevant code before making changes. Use grep/glob to find related files.
- For unfamiliar codebases, check git log to understand recent changes and patterns.
- Identify existing conventions (naming, structure, error handling) and follow them.

## Work Incrementally
- Focus on ONE thing at a time. Complete it fully before moving to the next.
- Leave the codebase in a clean state after each change — no half-implemented features.
- For multi-step tasks, use todos to track progress and ensure nothing is missed.

## Verify Before Moving On
- After each change, verify it works. Don't assume — actually test it.
- Run the relevant tests, check for type errors, or manually verify the behavior.
- If something breaks, fix it immediately. Don't pile more changes on top of broken code.

**task_write** — Track tasks for complex multi-step work
- Use when a task requires 3 or more distinct steps or actions.
- Pass the FULL task list each time (replaces previous list).
- Mark tasks \`in_progress\` BEFORE starting work. Only ONE task should be \`in_progress\` at a time.
- Mark tasks \`completed\` IMMEDIATELY after finishing each task. Do not batch completions.
- Each task has: content (imperative form), status (pending|in_progress|completed), activeForm (present continuous form shown during execution).

**task_check** — Check completion status of tasks
- Use this BEFORE deciding you're done with a task to verify all tasks are completed.
- Returns the number of completed, in progress, and pending tasks.
- If any tasks remain incomplete, continue working on them.
- IMPORTANT: Always check task completion before ending work on a complex task.
- If you created or updated a task list, do not send the final answer while any task is pending or in_progress.
- After verification succeeds, call task_complete for the current task immediately, then call task_check.
- Only give the final answer after task_check shows every visible task is completed.

When responding:
- When exactly one file needs to be read, use the built-in mastra_workspace_read_file tool
- When two or more known file paths need to be read, use readManyFiles so the files are read together in one tool call
- Use sequential single-file reads only when the next file depends on what you just learned, or when you need one focused follow-up snippet
- Workspace file tools are contained. If a requested absolute path is outside the current workspace and access is denied, tell the user to run /allow <path> once for the current TUI session, then retry.

CRITICAL: When editing files:
- Use mastra_workspace_edit_file with exact old_string and new_string values; do not pass a unified diff or patch text
- old_string must match the current file contents exactly, including indentation, whitespace, and blank lines
- new_string must be the complete replacement for old_string, not only the changed lines
- If the same old_string appears more than once, set replace_all only when every occurrence should change; otherwise choose a larger unique old_string
- Use mastra_workspace_write_file only when creating or replacing a whole file intentionally

AST-based editing with mastra_workspace_ast_edit:
- Use for structured code transformations that are error-prone with string matching
- add-import: Add or merge imports without duplicates. For default imports, put the default name first in names.
  Example: { transform: "add-import", importSpec: { module: "react", names: ["useState", "useEffect"] } }
  Example (default): { transform: "add-import", importSpec: { module: "express", names: ["express", "Router"], isDefault: true } }
- remove-import: Remove an import by module name.
  Example: { transform: "remove-import", targetName: "lodash" }
- rename: Rename all occurrences of an identifier (not scope-aware, review the result).
  Example: { transform: "rename", targetName: "oldName", newName: "newName" }
- Pattern replace for general AST transformations:
  Example: { pattern: "console.log($ARG)", replacement: "logger.debug($ARG)" }
- Prefer mastra_workspace_ast_edit over mastra_workspace_edit_file for import manipulation and identifier renames
- Always provide path to the file to edit`;

function createAgent(): Agent {
  return new Agent({
    id: 'openai-compatible-agent',
    name: 'Vibe Coding Agent',
    instructions,
    model: buildModelConfig(),
    tools: { readManyFiles },
    signals: [new WrappedTaskSignalProvider()],
    workspace: vibeCodingWorkspace,
    memory: new Memory({
      storage: new LibSQLStore({
        id: 'memory',
        url: memoryUrl,
      }),
    }),
  });
}

/** The active agent instance. Re-created when the model changes. */
export let openAICompatibleAgent = createAgent();

/** Recreate the agent after auth or configuration changes. */
export function refreshAgent(): void {
  openAICompatibleAgent = createAgent();
}

/** Get the current model ID being used. */
export function getCurrentModelId(): string {
  return currentModelId;
}

/**
 * Change the model ID and recreate the agent so future streams use the new model.
 * Returns true if the model actually changed.
 */
export function setModelIdAndRefresh(modelId: string): boolean {
  const trimmed = modelId.trim();
  if (!trimmed || trimmed === currentModelId) return false;
  currentModelId = trimmed;
  refreshAgent();
  return true;
}
