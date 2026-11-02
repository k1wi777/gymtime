/** Slots available in the AS608 reader (scratch slot included). */
export const MAX_SLOT = 162;

export type ConsoleCommand =
  | { kind: 'scan'; slot: number }
  | { kind: 'button' }
  | { kind: 'disconnect' }
  | { kind: 'reconnect' }
  | { kind: 'help' }
  | { kind: 'empty' }
  | { kind: 'invalid'; input: string; reason: string };

export const COMMAND_HELP = [
  'Interactive commands:',
  '  scan <slot>   send fingerprint.scan for a slot (1..162)',
  '  button        send button.pressed',
  '  disconnect    close the socket and stop reconnecting',
  '  reconnect     connect again and resume automatic reconnection',
  '  help          show this help',
].join('\n');

/** Parses one stdin line; side effects stay in `main.ts`/`DeviceClient`. */
export function parseCommand(input: string): ConsoleCommand {
  const text = input.trim();
  if (text === '') return { kind: 'empty' };
  const [name = '', ...args] = text.split(/\s+/);
  const invalid = (reason: string): ConsoleCommand => ({
    kind: 'invalid',
    input: text,
    reason,
  });
  const noArgs = (kind: 'button' | 'disconnect' | 'reconnect' | 'help') =>
    args.length === 0 ? { kind } : invalid(`usage: ${kind}`);

  switch (name.toLowerCase()) {
    case 'scan': {
      const raw = args[0];
      if (raw === undefined || args.length > 1) {
        return invalid('usage: scan <slot>');
      }
      if (!/^\d{1,3}$/.test(raw)) {
        return invalid(`slot must be an integer between 1 and ${MAX_SLOT}`);
      }
      const slot = Number(raw);
      if (slot < 1 || slot > MAX_SLOT) {
        return invalid(`slot must be an integer between 1 and ${MAX_SLOT}`);
      }
      return { kind: 'scan', slot };
    }
    case 'button':
      return noArgs('button');
    case 'disconnect':
      return noArgs('disconnect');
    case 'reconnect':
      return noArgs('reconnect');
    case 'help':
      return noArgs('help');
    default:
      return invalid(`unknown command "${name}"`);
  }
}
