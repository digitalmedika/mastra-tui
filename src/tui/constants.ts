import { SyntaxStyle, TextAttributes, getTreeSitterClient } from '@opentui/core';
import type { TuiSession } from './types';

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// Initialize tree-sitter client for syntax highlighting
export const treeSitterClient = getTreeSitterClient();

// Create syntax style with VS Code Dark+ theme colors
export const markdownSyntaxStyle = SyntaxStyle.fromTheme([
  { scope: ['comment'], style: { foreground: '#6A9955' } },
  { scope: ['string'], style: { foreground: '#CE9178' } },
  { scope: ['keyword'], style: { foreground: '#569CD6' } },
  { scope: ['function'], style: { foreground: '#DCDCAA' } },
  { scope: ['variable'], style: { foreground: '#9CDCFE' } },
  { scope: ['type'], style: { foreground: '#4EC9B0' } },
  { scope: ['number'], style: { foreground: '#B5CEA8' } },
  { scope: ['operator'], style: { foreground: '#D4D4D4' } },
  { scope: ['punctuation'], style: { foreground: '#D4D4D4' } },
  { scope: ['constant'], style: { foreground: '#4FC1FF' } },
  { scope: ['property'], style: { foreground: '#9CDCFE' } },
  { scope: ['tag'], style: { foreground: '#569CD6' } },
  { scope: ['attribute'], style: { foreground: '#9CDCFE' } },
]);

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
