/**
 * Limits of the reader's TFT messages (the server's defaults of
 * DISPLAY_TITLE_MAX, DISPLAY_SUBTITLE_MAX and DISPLAY_SUBTITLE_LINES). The
 * server is the authority; these only let the form warn before sending.
 */
export const DISPLAY_TITLE_MAX = 32;
export const DISPLAY_SUBTITLE_MAX = 80;
export const DISPLAY_SUBTITLE_LINES = 2;

export const DISPLAY_TONES = ['success', 'error', 'warning', 'info'] as const;
export type DisplayTone = (typeof DISPLAY_TONES)[number];

/** Suggested colour of each tone; the firmware picks the final RGB. */
export const DISPLAY_TONE_INFO: Record<
  DisplayTone,
  { label: string; color: string }
> = {
  success: { label: 'Éxito (verde)', color: '#2E9E5B' },
  error: { label: 'Rechazo (rojo)', color: '#D64545' },
  warning: { label: 'Aviso (naranja)', color: '#F08A24' },
  info: { label: 'Neutro (azul)', color: '#4A6FA5' },
};

export const displayTitleHelp = `Una línea, hasta ${DISPLAY_TITLE_MAX} caracteres. Se admiten tildes.`;
export const displaySubtitleHelp = `Opcional. Hasta ${DISPLAY_SUBTITLE_MAX} caracteres y ${DISPLAY_SUBTITLE_LINES} líneas (Enter hace un salto de línea).`;

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
