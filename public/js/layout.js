// Small pure helpers for the pages, kept apart from the page code so they can be tested without a browser.

/** The host's list of answers: waiting ones first, the newest on top, so the one that just arrived is where the host is already looking. */
export const answerOrder = (answers) =>
  [...answers].sort((a, b) => (a.status === "pending" ? 0 : 1) - (b.status === "pending" ? 0 : 1) || (b.at ?? 0) - (a.at ?? 0));

/** How the projector scoreboard is laid out: about twelve rows to a column, up to four columns. */
export function deckGrid(n) {
  const cols = Math.min(4, Math.max(1, Math.ceil(n / 12)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

/** How many of a team's theme guesses are shown before the older ones fold away. */
export const THEME_FOLD_KEEP = 5;

/**
 * Splits a team's theme guesses (oldest first) into the ones to show and the ones folded away, so a long run of guesses
 * never pushes the box and the question off the phone's screen. Numbering stays that of the whole list via `offset`.
 */
export function foldGuesses(list, showAll = false, keep = THEME_FOLD_KEEP) {
  const folded = !showAll && list.length > keep;
  const shown = folded ? list.slice(list.length - keep) : list;
  const hidden = list.slice(0, list.length - shown.length);
  return { shown, offset: list.length - shown.length, hiddenCount: hidden.length, hiddenStruck: hidden.filter((g) => g.struck).length, canFold: list.length > keep, folded };
}
