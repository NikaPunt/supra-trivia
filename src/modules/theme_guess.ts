import { z } from "zod";
import { normalize, type TriviaModule } from "./types.js";

const config = z.object({
  theme: z.string().min(1).max(200),
  hint: z.string().max(300).default(""),
  bonusPoints: z.number().int().min(0).max(1000).default(2),
});
const answer = z.object({ guess: z.string().min(1).max(200) });

/** Guesses are scoped to a round and cleared when it closes (see docs/BUGS.md, BUG-001). Host approval can also award bonus points. */
export const themeGuess: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "theme_guess",
  label: "Theme guess",
  description: "Players guess a hidden theme during a round; the host approves guesses for bonus points.",
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (normalize(c.theme) === normalize(a.guess) ? c.bonusPoints : 0),
};
