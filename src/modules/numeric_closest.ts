import { z } from "zod";
import { NUMBER_LIMIT, QUESTION_MAX, detailFields, frameShape, pointsField, pointsSchema, type TriviaModule } from "./types.js";

const config = z.object({
  ...frameShape,
  question: z.string().min(1).max(QUESTION_MAX),
  value: z.number().min(-NUMBER_LIMIT).max(NUMBER_LIMIT),
  points: pointsSchema.default(1),
});
const answer = z.object({ value: z.number().min(-NUMBER_LIMIT).max(NUMBER_LIMIT) });

export const numericClosest: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "numeric_closest",
  label: "Closest number",
  description: "The closest guess wins, ties share. A good tie-breaker for the end of a round.",
  fields: [
    {
      key: "question", label: "Question", kind: "textarea",
      placeholder: "The year Hong Kong returned to China, Deep Blue beat Kasparov, and Titanic reached cinemas.\n\nWhat year was it?",
    },
    { key: "value", label: "True number", kind: "number", default: 0 },
    pointsField,
    ...detailFields,
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
