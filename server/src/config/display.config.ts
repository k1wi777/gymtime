export interface DisplayConfig {
  /** Max characters of the one-line title (DISPLAY_TITLE_MAX). */
  titleMax: number;
  /** Max characters of the whole subtitle (DISPLAY_SUBTITLE_MAX). */
  subtitleMax: number;
  /** Max lines of the subtitle (DISPLAY_SUBTITLE_LINES). */
  subtitleLines: number;
  /** Max characters of a student's short name (DISPLAY_NAME_MAX). */
  nameMax: number;
  /** Default seconds a message stays on screen (DISPLAY_RESULT_SECONDS). */
  resultSeconds: number;
}

export const DISPLAY_CONFIG = Symbol('DISPLAY_CONFIG');
