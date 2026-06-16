import { createTool } from '@mastra/core/tools';
import { requireFilesystem } from '@mastra/core/workspace';
import { z } from 'zod';

const readManyFileResultSchema = z.object({
  path: z.string(),
  ok: z.boolean(),
  content: z.string().optional(),
  lineCount: z.number().int().nonnegative().optional(),
  bytes: z.number().int().nonnegative().optional(),
  error: z.string().optional(),
});

const countLines = (content: string) => {
  if (!content) return 0;
  const lines = content.split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.length;
};

const toErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error);
};

export const readManyFiles = createTool({
  id: 'readManyFiles',
  description:
    'Read two or more text files from the workspace in parallel. Do not use this for a single file; use the built-in mastra_workspace_read_file tool for exactly one file.',
  inputSchema: z.object({
    paths: z.array(z.string().min(1)).min(2).max(20).describe('Two or more workspace file paths to read in parallel.'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    totalFiles: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    totalLines: z.number().int().nonnegative(),
    files: z.array(readManyFileResultSchema),
  }),
  execute: async ({ paths }, context) => {
    const { filesystem } = requireFilesystem(context);

    const files = await Promise.all(
      paths.map(async (filePath) => {
        try {
          const rawContent = await filesystem.readFile(filePath, { encoding: 'utf8' });
          const content = typeof rawContent === 'string' ? rawContent : rawContent.toString('utf8');

          return {
            path: filePath,
            ok: true,
            content,
            lineCount: countLines(content),
            bytes: Buffer.byteLength(content, 'utf8'),
          };
        } catch (error) {
          return {
            path: filePath,
            ok: false,
            error: toErrorMessage(error),
          };
        }
      }),
    );

    const succeeded = files.filter((file) => file.ok).length;
    const totalLines = files.reduce((total, file) => total + (file.lineCount ?? 0), 0);

    return {
      ok: succeeded === files.length,
      totalFiles: files.length,
      succeeded,
      failed: files.length - succeeded,
      totalLines,
      files,
    };
  },
});
