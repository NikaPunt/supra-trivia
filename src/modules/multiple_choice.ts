import { z } from "zod";
import { clueFields, detailFields, frameShape, framePublic, pointsField, pointsSchema, type TriviaModule } from "./types.js";

const config = z
  .object({
    ...frameShape,
    question: z.string().min(1).max(500),
    options: z.array(z.string().min(1).max(200)).min(2).max(6),
    correct: z.number().int().min(0),
    points: pointsSchema.default(1),
  })
  .refine((c) => c.correct < c.options.length, { message: "correct must index into options" });
const answer = z.object({ choice: z.number().int().min(0).max(5) });

export const multipleChoice: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "multiple_choice",
  label: "Multiple choice",
  description: "Constrained options, good for Odd One Out and Two Truths & a Lie.",
  fields: [
    ...clueFields,
    { key: "question", label: "The question", kind: "textarea" },
    { key: "options", label: "Options", kind: "list", help: "one per line, 2 to 6" },
    { key: "correct", label: "Correct option number", kind: "index", default: 0, help: "1 is the first option" },
    pointsField,
    ...detailFields,
  ],
  input: { kind: "choice", key: "choice" },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (a.choice === c.correct ? c.points : 0),
  points: (c) => c.points,
  publicView: (c) => ({ ...framePublic(c), question: c.question, options: c.options }),
  solution: (c) => c.options[c.correct] ?? "",
};
