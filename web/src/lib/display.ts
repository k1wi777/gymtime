/** Characters per line of the reader's LCD (the server's DISPLAY_COLS default). */
export const DISPLAY_LINE_MAX = 16;
export const DISPLAY_LINES = 2;

/** Help shown under each line; built from the constant so they cannot drift. */
export const displayLineHelp = `Hasta ${DISPLAY_LINE_MAX} caracteres; sin tildes en la pantalla del lector.`;

/** Up to two initials of a full name: «Laura Martínez» gives «LM». */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

const AVATAR_TONES = 6;

/**
 * Stable avatar tone (1..6) from an id, so a student keeps the same color on
 * every screen. Presentation only.
 */
export function avatarTone(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return (hash % AVATAR_TONES) + 1;
}
