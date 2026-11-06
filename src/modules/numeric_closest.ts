import { z } from "zod";
import type { TriviaModule } from "./types.js";

const config = z.object({
  question: z.string().min(1).max(500),
  value: z.number().finite(),
  points: z.number().int().min(0).max(1000).default(1),
});
const answer = z.object({ value: z.number().finite() });

/** Closest-wins is decided across all players by the session, not per answer, so score() only reports an exact hit. */
export const numericClosest: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "numeric_closest",
  label: "Closest number",
  description: "The player closest to the true number wins the points.",
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (a.value === c.value ? c.points : 0),
};
