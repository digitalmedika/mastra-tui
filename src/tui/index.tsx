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
