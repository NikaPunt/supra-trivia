import { z } from "zod";
import { normalize, pointsField, type TriviaModule } from "./types.js";

const config = z.object({
  question: z.string().min(1).max(500),
  answers: z.array(z.string().min(1).max(200)).min(1).max(20),
  points: z.number().min(0).max(1000).multipleOf(0.5).default(1),
});
const answer = z.object({ text: z.string().min(1).max(200) });

export const textQa: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "text_qa",
  label: "Question and answer",
  description: "Players type a short answer. Accepted answers ignore case and punctuation.",
  fields: [
    { key: "question", label: "Question", kind: "textarea" },
    { key: "answers", label: "Accepted answers", kind: "list", help: "One per line" },
    pointsField,
  ],
  input: { kind: "text", key: "text" },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (c.answers.some((x) => normalize(x) === normalize(a.text)) ? c.points : 0),
  points: (c) => c.points,
  publicView: (c) => ({ question: c.question }),
  solution: (c) => c.answers.join(" / "),
};
