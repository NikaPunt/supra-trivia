import { z } from "zod";
import { QUESTION_MAX, detailFields, frameShape, normalize, type TriviaModule } from "./types.js";

const config = z.object({
  ...frameShape,
  question: z.string().min(1).max(QUESTION_MAX),
  answers: z.array(z.string().min(1).max(200)).min(1).max(20),
  maxWager: z.number().int().min(1).max(1000).default(20),
  capByScore: z.boolean().default(false),
});
const answer = z.object({ text: z.string().min(1).max(200), wager: z.number().int().min(0).max(1000) });

export const wager: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "wager",
  label: "Final wager (non-Jeopardy)",
  description: "Players see the question and give an answer and a wager together, up to a maximum. A right answer wins the wager, a wrong one loses it.",
  fields: [
    { key: "question", label: "Question", kind: "textarea", placeholder: "Born in Ohio and later a US president, he was also a Supreme Court chief justice.\n\nWho is he?" },
    { key: "answers", label: "Answer", kind: "list", help: "the answer first, then any other spellings, one per line" },
    { key: "maxWager", label: "Maximum wager", kind: "number", default: 20 },
    { key: "capByScore", label: "Wager capped by team score", kind: "checkbox", default: false, help: "a team can wager at most the points it has so far; the maximum above is then ignored" },
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
  publicView: (c) => ({ question: c.question, maxWager: c.maxWager }),
  solution: (c) => c.answers[0] ?? "",
};
