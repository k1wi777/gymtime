/** Document numbers read from a text file: one per line, comma or semicolon. */
export function parseDocuments(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const document = part.trim();
    if (document) seen.add(document);
  }
  return [...seen];
}
