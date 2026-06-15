import { useEffect, useState } from 'react';
import { SPINNER_FRAMES, greenFg, mutedFg, taskBg, textFg } from '../constants';
import type { TaskItem } from '../types';
import { compactText } from '../utils';
import { Badge } from './Badge';

export function TaskListPanel({
  tasks,
  sidePanel,
  terminalWidth,
}: {
  tasks: TaskItem[];
  sidePanel: boolean;
  terminalWidth: number;
}) {
  const completedTasks = tasks.filter((task) => task.done).length;
  const panelWidth = sidePanel ? Math.min(56, Math.max(42, Math.floor(terminalWidth * 0.3))) : terminalWidth;
  const taskTextMaxLength = sidePanel ? Math.max(20, panelWidth - 14) : Math.max(48, terminalWidth - 8);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    const hasInProgressTask = tasks.some((task) => task.current);
    if (!hasInProgressTask) return;
    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [tasks]);

  return (
    <box
      style={{
        width: sidePanel ? panelWidth : '100%',
        height: sidePanel ? '100%' : undefined,
        flexDirection: 'column',
        flexShrink: 0,
        border: sidePanel,
        paddingLeft: sidePanel ? 1 : 0,
        paddingRight: sidePanel ? 1 : 0,
      }}
    >
      <box style={{ width: '100%', flexDirection: 'row' }}>
        <Badge label="TASK LIST" bg={taskBg} />
        <text content={`  ${completedTasks}/${tasks.length}`} style={{ fg: mutedFg }} />
      </box>
      {tasks.map((task) => {
        const spinner = task.current ? ` ${SPINNER_FRAMES[spinnerFrame]}` : '';
        const availableTextLength = Math.max(16, taskTextMaxLength - spinner.length);
        const checkbox = task.done ? '[x]' : task.current ? '[-]' : '[ ]';
        const content = `${checkbox} ${task.index}. ${compactText(task.text, availableTextLength)}${spinner}`;

        return (
          <text
            key={task.index}
            content={content}
            style={{
              fg: task.done ? mutedFg : task.current ? greenFg : textFg,
              attributes: task.current ? ('bold' as any) : undefined,
            }}
          />
        );
      })}
    </box>
  );
}
