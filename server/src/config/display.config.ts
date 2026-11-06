export interface DisplayConfig {
  /** Characters per line of the reader LCD (DISPLAY_COLS). */
  cols: number;
  /** Lines of the reader LCD (DISPLAY_ROWS). */
  rows: number;
  /** Default seconds a message stays on screen (DISPLAY_RESULT_SECONDS). */
  resultSeconds: number;
}

export const DISPLAY_CONFIG = Symbol('DISPLAY_CONFIG');
