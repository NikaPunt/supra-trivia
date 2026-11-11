// Small pure helpers for the pages, kept apart from the page code so they can be tested without a browser.

/** The host's list of answers: waiting ones first, the newest on top, so the one that just arrived is where the host is already looking. */
export const answerOrder = (answers) =>
  [...answers].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || (b.at ?? 0) - (a.at ?? 0));

/** How the projector scoreboard is laid out: about twelve rows to a column, up to four columns. */
export function deckGrid(n) {
  const cols = Math.min(4, Math.max(1, Math.ceil(n / 12)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}
