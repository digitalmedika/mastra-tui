import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

const taskSchema = z.object({
  id: z.number().int().positive().describe('Task number shown in the TUI checklist'),
  title: z.string().min(1).describe('Short task title shown in the TUI checklist'),
  status: taskStatusSchema.default('pending').describe('Current task status'),
});

export const tuiTaskListTool = createTool({
  id: 'tui_task_list',
  description:
    'Update the terminal UI checklist. Use action=set when you decide the task plan, and action=update whenever a task starts or completes.',
  inputSchema: z.object({
    action: z.enum(['set', 'update']).describe('set replaces the visible checklist; update changes one task status'),
    tasks: z.array(taskSchema).optional().describe('Required for action=set'),
    taskId: z.number().int().positive().optional().describe('Required for action=update'),
    status: taskStatusSchema.optional().describe('Required for action=update'),
    note: z.string().optional().describe('Optional short progress note'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    action: z.enum(['set', 'update']),
    tasks: z.array(taskSchema).optional(),
    taskId: z.number().int().positive().optional(),
    status: taskStatusSchema.optional(),
    note: z.string().optional(),
  }),
  execute: async (inputData) => {
    return {
      ok: true,
      ...inputData,
    };
  },
});
