/** Characters per line of the reader's LCD (the server's DISPLAY_COLS default). */
export const DISPLAY_LINE_MAX = 16;
export const DISPLAY_LINES = 2;

/** Help shown under each line; built from the constant so they cannot drift. */
export const displayLineHelp = `Hasta ${DISPLAY_LINE_MAX} caracteres; sin tildes en la pantalla del lector.`;
