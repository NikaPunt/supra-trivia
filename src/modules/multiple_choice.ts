import { z } from "zod";
import { pointsField, type TriviaModule } from "./types.js";

const config = z
  .object({
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(6),
    correct: z.number().int().min(0),
    points: z.number().min(0).max(1000).multipleOf(0.5).default(1),
  })
  .refine((c) => c.correct < c.options.length, { message: "correct must index into options" });
const answer = z.object({ choice: z.number().int().min(0).max(5) });

export const multipleChoice: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "multiple_choice",
  label: "Multiple choice",
  description: "Players pick one of 2-6 options.",
  fields: [
    { key: "question", label: "Question", kind: "textarea" },
    { key: "options", label: "Options", kind: "list", help: "One per line, 2 to 6" },
    { key: "correct", label: "Correct option number", kind: "index", default: 0, help: "1 is the first option" },
    pointsField,
  ],
  input: { kind: "choice", key: "choice" },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (a.choice === c.correct ? c.points : 0),
  points: (c) => c.points,
  publicView: (c) => ({ question: c.question, options: c.options }),
  solution: (c) => c.options[c.correct] ?? "",
};
