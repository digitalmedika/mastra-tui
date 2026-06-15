import path from 'node:path';
import { Agent } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { getStoredSession } from '../../tui/auth/storage';
import { defaultWorkspacePath, findProjectRoot } from '../../workspace';
import { tuiTaskListTool } from '../tools/tui-task-list-tool';

const projectRoot = findProjectRoot();

const providerId = process.env.OPENAI_COMPATIBLE_PROVIDER_ID ?? 'custom';
const authServerUrl = process.env.AUTH_SERVER_URL ?? 'http://localhost:3001';
const explicitBaseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
const baseUrl = explicitBaseUrl || `${authServerUrl}/v1`;
const envApiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
const workspacePath = defaultWorkspacePath;
const memoryUrl = process.env.OPENAI_COMPATIBLE_MEMORY_URL ?? `file:${path.join(projectRoot, '.mastra', 'openai-compatible-agent-memory.db').replace(/\\/g, '/')}`;

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
  filesystem: new LocalFilesystem({
    basePath: workspacePath,
  }),
  sandbox: new LocalSandbox({
    workingDirectory: workspacePath,
  }),
});

const instructions = `You are a vibe coding assistant: a collaborative software partner who helps users turn rough ideas into working code through fast, thoughtful iteration.

When responding:
- Start from the user's intent, even when the brief is casual or incomplete
- Propose a simple implementation path, then help refine it through feedback
- When a task needs multiple steps, call tui_task_list with action=set before starting work
- Call tui_task_list with action=update and status=in_progress when starting a task
- Call tui_task_list with action=update and status=completed immediately after finishing a task
- Favor small, working increments over over-engineered plans
- Explain tradeoffs briefly and choose sensible defaults when the user has not specified details
- Write clear code with maintainable structure and practical naming
- Point out likely bugs, edge cases, and missing requirements before they become expensive
- Match the user's language and tone when possible
- Be honest about what you can inspect or change, and do not claim access to tools or systems that are not available

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
    tools: { tuiTaskListTool },
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
