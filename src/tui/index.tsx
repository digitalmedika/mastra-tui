// Register the agent with a Mastra instance before the app starts.
// This wires `context.mastra` for the TaskSignalProvider so task tools can
// persist state and emit `task_updated` harness events that keep the TUI
// checklist in sync. Without this, the task list never updates its status.
import '../mastra';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from './components';

const renderer = await createCliRenderer();
const root = createRoot(renderer);

const exit = () => {
  root.unmount();
  renderer.destroy();
  process.exit(0);
};

root.render(<App onExit={exit} />);
