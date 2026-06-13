import { Agent } from '@mastra/core/agent';
import type { OpenAICompatibleConfig } from '@mastra/core/llm';
import { LocalFilesystem, LocalSandbox, Workspace } from '@mastra/core/workspace';
import { LibSQLStore } from '@mastra/libsql';
import { Memory } from '@mastra/memory';
import { tuiTaskListTool } from '../tools/tui-task-list-tool';

const providerId = process.env.OPENAI_COMPATIBLE_PROVIDER_ID ?? 'custom';
const modelId = process.env.OPENAI_COMPATIBLE_MODEL ?? 'gpt-4o-mini';
const baseUrl = process.env.OPENAI_COMPATIBLE_BASE_URL ?? 'https://api.openai.com/v1';
const apiKey = process.env.OPENAI_COMPATIBLE_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
const workspacePath = process.env.VIBE_CODING_WORKSPACE_PATH ?? '/Users/billymontolalu/Documents/project/central';
const memoryUrl = process.env.OPENAI_COMPATIBLE_MEMORY_URL ?? 'file:./.mastra/openai-compatible-agent-memory.db';

const openAICompatibleModel: OpenAICompatibleConfig = {
  providerId,
  modelId,
  url: baseUrl,
  apiKey,
};

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

export const openAICompatibleAgent = new Agent({
  id: 'openai-compatible-agent',
  name: 'Vibe Coding Agent',
  instructions: `You are a vibe coding assistant: a collaborative software partner who helps users turn rough ideas into working code through fast, thoughtful iteration.

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
- Be honest about what you can inspect or change, and do not claim access to tools or systems that are not available`,
  model: openAICompatibleModel,
  tools: { tuiTaskListTool },
  workspace: vibeCodingWorkspace,
  memory: new Memory({
    storage: new LibSQLStore({
      id: 'openai-compatible-agent-memory',
      url: memoryUrl,
    }),
  }),
});
