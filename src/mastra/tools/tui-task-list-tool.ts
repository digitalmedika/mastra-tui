import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const taskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);

const taskSchema = z.object({
  id: z.number().int().positive().describe('Task number shown in the TUI checklist'),
  title: z.string().min(1).describe('Short task title shown in the TUI checklist'),
  status: taskStatusSchema.default('pending').describe('Current task status'),
});

const trackedTaskSchema = z.object({
  content: z.string().min(1).describe('Imperative task title shown in the TUI checklist'),
  status: taskStatusSchema.describe('Current task status'),
  activeForm: z.string().min(1).optional().describe('Present-continuous form shown while executing this task'),
});

const countTasks = (tasks: Array<{ status: z.infer<typeof taskStatusSchema> }>) => {
  const completed = tasks.filter((task) => task.status === 'completed').length;
  const inProgress = tasks.filter((task) => task.status === 'in_progress').length;
  const pending = tasks.filter((task) => task.status === 'pending').length;

  return {
    total: tasks.length,
    completed,
    inProgress,
    pending,
    allCompleted: tasks.length > 0 && completed === tasks.length,
  };
};

export const tuiTaskList = createTool({
  id: 'tuiTaskList',
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

export const taskWrite = createTool({
  id: 'task_write',
  description:
    'Track tasks for complex multi-step work. Pass the FULL task list each time, mark exactly one task in_progress before starting it, and mark each task completed immediately after verifying it.',
  inputSchema: z.object({
    tasks: z.array(trackedTaskSchema).min(1).describe('Full replacement task list in current order'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    allCompleted: z.boolean(),
    tasks: z.array(trackedTaskSchema),
  }),
  execute: async ({ tasks }) => ({
    ok: true,
    ...countTasks(tasks),
    tasks,
  }),
});

export const taskCheck = createTool({
  id: 'task_check',
  description:
    'Check completion status before ending complex work. Pass the FULL current task list. If allCompleted is false, continue working or update the checklist before claiming completion.',
  inputSchema: z.object({
    tasks: z.array(trackedTaskSchema).min(1).describe('Full current task list to verify before the final response'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    total: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    allCompleted: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ tasks }) => {
    const counts = countTasks(tasks);

    return {
      ok: counts.allCompleted,
      ...counts,
      message: counts.allCompleted
        ? 'All tracked tasks are completed. You may now give the final response.'
        : 'Some tracked tasks are still pending or in progress. Continue working before the final response.',
    };
  },
});
