import { z } from "zod";
import { clueFields, detailFields, frameShape, framePublic, normalize, pointsField, pointsSchema, type TriviaModule } from "./types.js";

const config = z.object({
  ...frameShape,
  question: z.string().min(1).max(500),
  answers: z.array(z.string().min(1).max(200)).min(1).max(20),
  points: pointsSchema.default(1),
});
const answer = z.object({ text: z.string().min(1).max(200) });

export const textQa: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "text_qa",
  label: "Question and answer",
  description: "Two clues and a question; players type a short answer. Accepted answers ignore case and punctuation.",
  fields: [
    ...clueFields,
    { key: "question", label: "The question", kind: "textarea", help: 'e.g. "Which Asian country is this?"' },
    { key: "answers", label: "Accepted answers", kind: "list", help: "one per line: the answer, plus spellings and last-name-only" },
    pointsField,
    ...detailFields,
  ],
  input: { kind: "text", key: "text" },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (c.answers.some((x) => normalize(x) === normalize(a.text)) ? c.points : 0),
  points: (c) => c.points,
  publicView: (c) => ({ ...framePublic(c), question: c.question }),
  solution: (c) => c.answers[0] ?? "",
};
