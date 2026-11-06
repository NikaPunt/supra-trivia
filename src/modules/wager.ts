import { z } from "zod";
import { clueFields, detailFields, frameShape, framePublic, normalize, type TriviaModule } from "./types.js";

const config = z.object({
  ...frameShape,
  question: z.string().min(1).max(500),
  answers: z.array(z.string().min(1).max(200)).min(1).max(20),
  maxWager: z.number().int().min(1).max(1000).default(20),
});
const answer = z.object({ text: z.string().min(1).max(200), wager: z.number().int().min(0).max(1000) });

export const wager: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "wager",
  label: "Final wager",
  description: "Jeopardy-style: players wager up to a maximum. A right answer wins the wager, a wrong one loses it.",
  fields: [
    ...clueFields,
    { key: "question", label: "The question", kind: "textarea" },
    { key: "answers", label: "Accepted answers", kind: "list", help: "one per line" },
    { key: "maxWager", label: "Maximum wager", kind: "number", default: 20 },
    ...detailFields,
  ],
  input: { kind: "text", key: "text" },
  configSchema: config,
  answerSchema: answer,
  stake: (c) => ({ key: "wager", label: "Your wager", min: 0, max: c.maxWager }),
  score: (c, a) => (c.answers.some((x) => normalize(x) === normalize(a.text)) ? a.wager : a.wager ? -a.wager : 0),
  points: (c) => c.maxWager,
  fullPoints: (_c, a) => a.wager,
  wrongPoints: (_c, a) => (a.wager ? -a.wager : 0),
  publicView: (c) => ({ ...framePublic(c), question: c.question, maxWager: c.maxWager }),
  solution: (c) => c.answers[0] ?? "",
};
