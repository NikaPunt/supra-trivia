import { z } from "zod";
import { QUESTION_MAX, detailFields, frameShape, pointsField, pointsSchema, type TriviaModule } from "./types.js";

const config = z
  .object({
    ...frameShape,
    question: z.string().min(1).max(QUESTION_MAX),
    options: z.array(z.string().min(1).max(200)).min(2).max(6),
    correct: z.number().int().min(0),
    points: pointsSchema.default(1),
  })
  .refine((c) => c.correct < c.options.length, { message: "correct must index into options" });
const answer = z.object({ choice: z.number().int().min(0).max(5) });

export const multipleChoice: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "multiple_choice",
  label: "Multiple choice",
  description: "2 to 6 options. Good for Odd One Out and Two Truths and a Lie.",
  fields: [
    { key: "question", label: "Question", kind: "textarea", placeholder: "Which of these South American countries has no coastline?" },
    { key: "options", label: "Options", kind: "list", help: "one per line, 2 to 6", placeholder: "Peru\nBolivia\nChile\nEcuador" },
    { key: "correct", label: "Correct option number", kind: "index", default: 0, help: "1 is the first option" },
    pointsField,
    ...detailFields,
  ],
  input: { kind: "choice", key: "choice" },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (a.choice === c.correct ? c.points : 0),
  points: (c) => c.points,
  publicView: (c) => ({ question: c.question, options: c.options }),
  solution: (c) => c.options[c.correct] ?? "",
};
