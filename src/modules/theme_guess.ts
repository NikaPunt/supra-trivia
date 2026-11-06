import { z } from "zod";
import { normalize, type TriviaModule } from "./types.js";

const config = z.object({
  theme: z.string().min(1).max(200),
  hint: z.string().max(300).default(""),
  bonusPoints: z.number().int().min(0).max(1000).default(2),
});
const answer = z.object({ guess: z.string().min(1).max(200) });

/**
 * Guesses are held for this one item only and capped per player by the engine, then dropped
 * when the host moves on (see docs/BUGS.md, BUG-001). Exact matches are auto-approved at reveal; the host can
 * approve or reject any guess by hand.
 */
export const themeGuess: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "theme_guess",
  label: "Theme guess",
  description: "Players guess a hidden theme; the host approves guesses for bonus points.",
  fields: [
    { key: "theme", label: "Theme", kind: "text" },
    { key: "hint", label: "Hint", kind: "text" },
    { key: "bonusPoints", label: "Bonus points", kind: "number", default: 2 },
  ],
  input: { kind: "text", key: "guess", multi: true },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (normalize(c.theme) === normalize(a.guess) ? c.bonusPoints : 0),
  points: (c) => c.bonusPoints,
  publicView: (c) => ({ question: "What is the theme?", hint: c.hint }),
  solution: (c) => c.theme,
};
