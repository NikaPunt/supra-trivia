import { z } from "zod";
import { pointsField, type TriviaModule } from "./types.js";

const config = z.object({
  question: z.string().min(1).max(500),
  value: z.number().finite(),
  points: z.number().int().min(0).max(1000).default(1),
});
const answer = z.object({ value: z.number().finite() });

export const numericClosest: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "numeric_closest",
  label: "Closest number",
  description: "The player closest to the true number wins the points. Ties share them.",
  fields: [
    { key: "question", label: "Question", kind: "textarea" },
    { key: "value", label: "True number", kind: "number", default: 0 },
    pointsField,
  ],
  input: { kind: "number", key: "value" },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (a.value === c.value ? c.points : 0),
  scoreAll: (c, answers) => {
    const dist = answers.map((a) => Math.abs(a.value.value - c.value));
    const best = Math.min(...dist);
    return new Map(answers.map((a, i) => [a.playerId, dist[i] === best ? c.points : 0]));
  },
  points: (c) => c.points,
  publicView: (c) => ({ question: c.question }),
  solution: (c) => String(c.value),
};
