import { greenBg, greenFg, mutedFg, textFg } from '../constants';

export type SlashCommand = {
  /** Text shown in the suggestion dropdown */
  command: string;
  /** Text inserted into the textarea when selected */
  insertText: string;
  description: string;
  /**
   * If 'approval', only visible when status is 'awaiting-approval'.
   * If 'idle', only visible when status is 'idle', 'finished', or 'error' (not streaming/awaiting).
   * If undefined, always visible.
   */
  requires?: 'approval' | 'idle';
};

export const SLASH_COMMANDS: SlashCommand[] = [
  { command: '/approve', insertText: '/approve', description: 'Approve pending tool call', requires: 'approval' },
  { command: '/deny', insertText: '/deny', description: 'Deny pending tool call', requires: 'approval' },
  { command: '/attach <path>', insertText: '/attach ', description: 'Attach an image file', requires: 'idle' },
  { command: '/clear', insertText: '/clear', description: 'Clear chat memory', requires: 'idle' },
  { command: '/sessions', insertText: '/sessions', description: 'Open session picker', requires: 'idle' },
  { command: '/model', insertText: '/model', description: 'Open model picker', requires: 'idle' },
  { command: '/allow <path>', insertText: '/allow ', description: 'Allow external workspace path', requires: 'idle' },
  { command: '/new <title>', insertText: '/new ', description: 'Create a new session with title', requires: 'idle' },
  { command: '/allow', insertText: '/allow', description: 'Show allowed external paths', requires: 'idle' },
  { command: '/new', insertText: '/new', description: 'Create a new session', requires: 'idle' },
  { command: '/logout', insertText: '/logout', description: 'Log out' },
];

export type SlashCommandSuggestionProps = {
  /** Filtered list of commands to display */
  suggestions: SlashCommand[];
  /** Currently highlighted index */
  selectedIndex: number;
  /** Whether the suggestion box is visible */
  visible: boolean;
};

export function SlashCommandSuggestion({ suggestions, selectedIndex, visible }: SlashCommandSuggestionProps) {
  if (!visible || suggestions.length === 0) return null;

  return (
    <box
      style={{
        width: '100%',
        flexDirection: 'column',
        flexShrink: 0,
        border: true,
        borderStyle: 'single',
        borderColor: mutedFg,
        paddingLeft: 1,
        paddingRight: 1,
      }}
    >
      {suggestions.map((cmd, index) => (
        <box
          key={cmd.command}
          style={{
            width: '100%',
            height: 1,
            flexDirection: 'row',
            flexShrink: 0,
          }}
        >
          <text
            content={index === selectedIndex ? '▶' : ' '}
            style={{ fg: greenFg, width: 2, flexShrink: 0 }}
          />
          <text
            content={cmd.command}
            style={{
              fg: index === selectedIndex ? greenFg : textFg,
              ...(index === selectedIndex ? { bg: greenBg } : {}),
            }}
          />
          <text content="  " style={{ fg: mutedFg, flexShrink: 0 }} />
          <text
            content={cmd.description}
            style={{
              fg: index === selectedIndex ? greenFg : mutedFg,
              ...(index === selectedIndex ? { bg: greenBg } : {}),
            }}
          />
        </box>
      ))}
    </box>
  );
}

/**
 * Filter slash commands based on the current input text and app status.
 */
export function filterSlashCommands(input: string, status: string): SlashCommand[] {
  if (!input.startsWith('/')) return [];

  const lowerInput = input.toLowerCase();
  const isIdle = status === 'idle' || status === 'finished' || status === 'error';

  return SLASH_COMMANDS.filter((cmd) => {
    if (cmd.requires === 'approval' && status !== 'awaiting-approval') return false;
    if (cmd.requires === 'idle' && !isIdle) return false;
    // Filter by typed text
    return cmd.command.toLowerCase().startsWith(lowerInput);
  });
}
