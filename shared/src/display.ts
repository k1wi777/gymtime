import { z } from 'zod';

export const DISPLAY_TONES = ['success', 'error', 'warning', 'info'] as const;
export type DisplayTone = (typeof DISPLAY_TONES)[number];
export const displayToneSchema = z.enum(DISPLAY_TONES);

/** Defaults of the 3.5" TFT; the server reads them from the environment. */
export const DISPLAY_DEFAULTS = {
  titleMax: 32,
  subtitleMax: 80,
  subtitleLines: 2,
  nameMax: 24,
  resultSeconds: 3,
} as const;

/** Deprecated `color` of protocol v1, derived from the tone during the transition. */
export const LEGACY_TONE_COLORS: Record<DisplayTone, string> = {
  success: 'green',
  error: 'red',
  warning: 'orange',
  info: 'white',
};

export interface DisplayLimits {
  titleMax: number;
  subtitleMax: number;
  subtitleLines: number;
}

export const DEFAULT_DISPLAY_LIMITS: DisplayLimits = {
  titleMax: DISPLAY_DEFAULTS.titleMax,
  subtitleMax: DISPLAY_DEFAULTS.subtitleMax,
  subtitleLines: DISPLAY_DEFAULTS.subtitleLines,
};

export type DisplayField = 'title' | 'subtitle';

export interface DisplayFieldError {
  field: DisplayField;
  /** The limit that was exceeded, or null when it is not a size problem. */
  limit: number | null;
  message: string;
}

export interface DisplayMessageContent {
  title: string;
  subtitle: string;
  tone: DisplayTone;
}

export type DisplayValidation =
  | { ok: true; message: DisplayMessageContent }
  | { ok: false; errors: DisplayFieldError[] };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

/**
 * Keeps accents and the enye: collapses blanks inside each line, trims the
 * lines and drops empty ones at the ends. Lines are separated by `\n`.
 */
export function normalizeDisplayText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/** Normalizes and checks a message against the limits; only printable text passes. */
export function validateDisplayMessage(
  input: { title: string; subtitle?: string; tone?: DisplayTone },
  limits: DisplayLimits = DEFAULT_DISPLAY_LIMITS,
): DisplayValidation {
  const title = normalizeDisplayText(input.title);
  const subtitle = normalizeDisplayText(input.subtitle ?? '');
  const errors: DisplayFieldError[] = [];
  if (title.includes('\n')) {
    errors.push({
      field: 'title',
      limit: 1,
      message: 'el título debe ser de una sola línea',
    });
  }
  if (title.length > limits.titleMax) {
    errors.push({
      field: 'title',
      limit: limits.titleMax,
      message: `el título tiene ${title.length} caracteres; máximo ${limits.titleMax}`,
    });
  }
  if (CONTROL_CHARS.test(title)) {
    errors.push({
      field: 'title',
      limit: null,
      message: 'el título contiene caracteres no imprimibles',
    });
  }
  const lines = subtitle === '' ? 0 : subtitle.split('\n').length;
  if (lines > limits.subtitleLines) {
    errors.push({
      field: 'subtitle',
      limit: limits.subtitleLines,
      message: `el subtítulo tiene ${lines} líneas; máximo ${limits.subtitleLines}`,
    });
  }
  if (subtitle.length > limits.subtitleMax) {
    errors.push({
      field: 'subtitle',
      limit: limits.subtitleMax,
      message: `el subtítulo tiene ${subtitle.length} caracteres; máximo ${limits.subtitleMax}`,
    });
  }
  if (CONTROL_CHARS.test(subtitle)) {
    errors.push({
      field: 'subtitle',
      limit: null,
      message: 'el subtítulo contiene caracteres no imprimibles',
    });
  }
  return errors.length === 0
    ? { ok: true, message: { title, subtitle, tone: input.tone ?? 'info' } }
    : { ok: false, errors };
}

/** What goes on the wire: the contract fields plus the deprecated v1 aliases. */
export interface DisplayPayload extends DisplayMessageContent {
  line1: string;
  line2: string;
  color: string;
}

/** Single builder of the display payload so the aliases never diverge. */
export function buildDisplayPayload(
  content: DisplayMessageContent,
): DisplayPayload {
  return {
    title: content.title,
    subtitle: content.subtitle,
    tone: content.tone,
    line1: content.title,
    line2: content.subtitle,
    color: LEGACY_TONE_COLORS[content.tone],
  };
}

const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * ASCII-only form (`á→a`, `ñ→n`). Only for the offline roster, which stays
 * ASCII; the screen itself keeps accents.
 */
export function toAscii(text: string): string {
  return text
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const FALLBACK_NAME = 'Estudiante';

/**
 * Short name for the screen: the full name when it fits; otherwise the first
 * name plus the initial of the next one (`Ana M.`); as a last resort the first
 * name cut to `max`. Never empty; keeps accents and the enye.
 */
export function generateDisplayName(fullName: string, max: number): string {
  const clean = normalizeDisplayText(fullName)
    .replace(/\n/g, ' ')
    .replace(new RegExp(CONTROL_CHARS.source, 'g'), '')
    .trim();
  if (clean === '') return FALLBACK_NAME.slice(0, max);
  if (clean.length <= max) return clean;
  const [first, second] = clean.split(' ');
  const short = second ? `${first} ${second[0].toUpperCase()}.` : first;
  return short.length <= max ? short : first.slice(0, max);
}
