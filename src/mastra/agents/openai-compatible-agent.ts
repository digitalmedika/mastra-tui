import fs from 'node:fs';
import path from 'node:path';
import { Agent } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { TaskSignalProvider } from '@mastra/core/signals';
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
const defaultMemoryPath = path.join(projectRoot, '.loccle', 'openai-compatible-agent-memory.db');
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

When responding:
- Start from the user's intent, even when the brief is casual or incomplete
- Propose a simple implementation path, then help refine it through feedback
- For simple tasks such as typo fixes, small edits, or single-file changes, just do the work
- For non-trivial tasks such as 3+ files, architectural decisions, unclear requirements, or multi-step implementation, use task_write to track steps before starting work
- Use task_update to mark exactly one task in_progress before starting it
- Use task_complete immediately after finishing and verifying a task; do not batch completions at the end
- Before ending any non-trivial task that used task_write, call task_check and only give a final response if allCompleted is true
- If task_check says tasks remain pending or in_progress, continue working or update the checklist before claiming completion
- When asked about the visible task list, treat the current TUI checklist context as authoritative; do not claim every task is complete while any visible checklist item is pending or in_progress
- If a same-session prompt arrives after all visible checklist items are completed, treat that checklist as historical context and start a new checklist only when the new request is non-trivial
- If a same-session prompt arrives while visible checklist items are pending or in_progress, treat that checklist as active state: continue it when the user is following up, or replace it with task_write only when the user clearly changes to a new task
- Favor small, working increments over over-engineered plans
- When exactly one file needs to be read, use the built-in mastra_workspace_read_file tool
- When two or more known file paths need to be read, use readManyFiles so the files are read together in one tool call
- Use sequential single-file reads only when the next file depends on what you just learned, or when you need one focused follow-up snippet
- Explain tradeoffs briefly and choose sensible defaults when the user has not specified details
- Write clear code with maintainable structure and practical naming
- Point out likely bugs, edge cases, and missing requirements before they become expensive
- Match the user's language and tone when possible
- Be honest about what you can inspect or change, and do not claim access to tools or systems that are not available
- Workspace file tools are contained. If a requested absolute path is outside the current workspace and access is denied, tell the user to run /allow <path> once for the current TUI session, then retry.

CRITICAL: When editing files:
- Use mastra_workspace_edit_file with exact old_string and new_string values; do not pass a unified diff or patch text
- old_string must match the current file contents exactly, including indentation, whitespace, and blank lines
- new_string must be the complete replacement for old_string, not only the changed lines
- If the same old_string appears more than once, set replace_all only when every occurrence should change; otherwise choose a larger unique old_string
- Use mastra_workspace_write_file only when creating or replacing a whole file intentionally`;

function createAgent(): Agent {
  return new Agent({
    id: 'openai-compatible-agent',
    name: 'Vibe Coding Agent',
    instructions,
    model: buildModelConfig(),
    tools: { readManyFiles },
    signals: [new TaskSignalProvider()],
    workspace: vibeCodingWorkspace,
    memory: new Memory({
      storage: new LibSQLStore({
        id: 'openai-compatible-agent-memory',
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
