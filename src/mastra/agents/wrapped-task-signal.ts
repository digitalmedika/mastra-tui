/**
 * Wraps the TaskSignalProvider tools so they receive the context they need.
 *
 * The Mastra core's tool-execution loop builds a `toolOptions` object that
 * does **not** include `threadId`, `resourceId`, or `mastra`.  The `Tool`
 * class then constructs `context.agent` from those options, which means
 * `context.agent.threadId` is always `undefined` and `isMemoryBacked` fails.
 *
 * This module wraps each task tool's `execute` so that it receives the
 * correct context before the `Tool` class wrapper runs.
 */
import { TaskSignalProvider } from '@mastra/core/signals';

/** Set by `mastra/index.ts` after the Mastra singleton is created. */
let mastraRef: unknown = null;
export function setMastraRef(m: unknown) {
  mastraRef = m;
}

const TASK_TOOL_IDS = ['task_write', 'task_update', 'task_complete', 'task_check'] as const;

export class WrappedTaskSignalProvider extends TaskSignalProvider {
  override getTools() {
    const tools = super.getTools();

    for (const tool of Object.values(tools)) {
      const id = (tool as { id?: string }).id;
      if (!id || !(TASK_TOOL_IDS as readonly string[]).includes(id)) continue;

      const origExec = (tool as { execute: Function }).execute;
      (tool as { execute: Function }).execute = async (inputData: unknown, context: Record<string, unknown> | null | undefined) => {
        const rc = context?.requestContext as { get?: (key: string) => unknown } | undefined;
        const harness = rc?.get?.('harness') as { threadId?: string; resourceId?: string } | undefined;

        const newContext: Record<string, unknown> = {
          ...context,
          agent: {
            ...((context?.agent as Record<string, unknown>) ?? {}),
            threadId: harness?.threadId,
            resourceId: harness?.resourceId,
          },
          mastra: context?.mastra ?? mastraRef,
        };

        return origExec(inputData, newContext);
      };
    }

    return tools;
  }
}
