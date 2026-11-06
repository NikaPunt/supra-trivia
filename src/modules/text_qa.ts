import { z } from "zod";
import { QUESTION_MAX, detailFields, frameShape, normalize, pointsField, pointsSchema, type TriviaModule } from "./types.js";

const config = z.object({
  ...frameShape,
  question: z.string().min(1).max(QUESTION_MAX),
  answers: z.array(z.string().min(1).max(200)).min(1).max(20),
  points: pointsSchema.default(1),
});
const answer = z.object({ text: z.string().min(1).max(200) });

export const textQa: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "text_qa",
  label: "Question and answer",
  description: "Players type a short answer. Spelling, case and punctuation are forgiving.",
  fields: [
    {
      key: "question", label: "Question", kind: "textarea",
      placeholder: "Its national flag is the only one in the world that is not a four-sided rectangle. Located in the Himalayas, it is home to Mount Everest.\n\nWhich Asian country is this?",
    },
    { key: "answers", label: "Answer", kind: "list", help: "the answer first, then any other spellings to accept, one per line", placeholder: "Nepal" },
    pointsField,
    ...detailFields,
  ],
  input: { kind: "text", key: "text" },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (c.answers.some((x) => normalize(x) === normalize(a.text)) ? c.points : 0),
  points: (c) => c.points,
  publicView: (c) => ({ question: c.question }),
  solution: (c) => c.answers[0] ?? "",
};
