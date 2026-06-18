
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { LibSQLStore } from '@mastra/libsql';
import { DuckDBStore } from "@mastra/duckdb";
import { MastraCompositeStore } from '@mastra/core/storage';
import { Observability, MastraStorageExporter, MastraPlatformExporter, SensitiveDataFilter } from '@mastra/observability';
import { weatherWorkflow } from './workflows/weather-workflow';
import { openAICompatibleAgent } from './agents/openai-compatible-agent';
import { readManyFiles } from './tools/read-many-files-tool';
import { weatherTool } from './tools/weather-tool';
import { toolCallAppropriatenessScorer, completenessScorer, translationScorer } from './scorers/weather-scorer';

const desktopMode = process.env.DESKTOP_MODE === 'true';
const duckDBPath = process.env.MASTRA_DUCKDB_PATH?.trim() || (desktopMode ? ':memory:' : '.loccle/mastra.duckdb');

export const mastra = new Mastra({
  workflows: { weatherWorkflow },
  agents: { openAICompatibleAgent },
  tools: { weatherTool, readManyFiles },
  scorers: { toolCallAppropriatenessScorer, completenessScorer, translationScorer },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: "mastra-storage",
      url: "file:./.loccle/loccle.db",
    }),
    domains: {
      observability: await new DuckDBStore({ path: duckDBPath }).getStore('observability'),
    }
  }),
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'info',
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'mastra',
        exporters: [
          new MastraStorageExporter(), // Persists observability events to Mastra Storage
          new MastraPlatformExporter(), // Sends observability events to Mastra Platform (if MASTRA_PLATFORM_ACCESS_TOKEN is set)
        ],
        spanOutputProcessors: [
          new SensitiveDataFilter(), // Redacts sensitive data like passwords, tokens, keys
        ],
      },
    },
  }),
  server: {
    port: Number(process.env.MASTRA_PORT) || 4112,
    cors: {
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
    },
    timeout: 600_000,
  },
});
