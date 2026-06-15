import { SyntaxStyle, TextAttributes } from '@opentui/core';
import type { TuiSession } from './types';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const markdownSyntaxStyle = SyntaxStyle.create();

export const workspacePath = process.env.VIBE_CODING_WORKSPACE_PATH ?? '/Users/billymontolalu/Documents/project/central';
export const configuredMaxSteps = Number(process.env.VIBE_CODING_MAX_STEPS);
export const agentMaxSteps = Number.isFinite(configuredMaxSteps) && configuredMaxSteps > 0 ? configuredMaxSteps : 60;

export const mutedFg = '#7e8494';
export const textFg = '#e8edf7';
export const pathFg = '#f2f5ff';
export const purpleBg = '#5a3fc8';
export const greenFg = '#2fd26f';
export const greenBg = '#00583c';
export const redFg = '#f87171';
export const redBg = '#4a1d24';
export const exploreBg = '#7547ff';
export const branchFg = '#9aa3b8';
export const shellBg = '#2374ab';
export const taskBg = '#6b4dff';
export const runBg = '#6d5dfc';
export const assistantMarkerFg = '#c8a7ff';

export const tuiResourceId = 'tui-user';
export const defaultSessionId = 'tui-session';

export const defaultSession: TuiSession = {
  id: defaultSessionId,
  title: 'Default session',
};
