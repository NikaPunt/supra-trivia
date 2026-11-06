import { z } from "zod";
import { clueFields, detailFields, frameShape, framePublic, normalize, type TriviaModule } from "./types.js";

const config = z.object({
  ...frameShape,
  question: z.string().min(1).max(500),
  answers: z.array(z.string().min(1).max(200)).min(1).max(20),
  poolId: z.string().min(1).max(30).default("confidence"),
  poolValues: z.array(z.number().positive().max(1000).multipleOf(0.5)).min(2).max(10),
});
const answer = z.object({ text: z.string().min(1).max(200), bet: z.number() });

/** Removes one occurrence of each used value, so a pool like [8, 6, 4, 2] can be spent once each. */
const remaining = (values: number[], used: number[]) => {
  const left = [...values];
  for (const u of used) {
    const i = left.indexOf(u);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
};

export const confidence: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "confidence",
  label: "Confidence set",
  description: "A set of questions that share a pool of point values (e.g. 8, 6, 4, 2). Each player spends each value once, on the questions they feel surest about.",
  fields: [
    ...clueFields,
    { key: "question", label: "The question", kind: "textarea" },
    { key: "answers", label: "Accepted answers", kind: "list", help: "one per line" },
    { key: "poolId", label: "Pool name", kind: "text", default: "confidence", help: "questions with the same name share one pool" },
    { key: "poolValues", label: "Pool values", kind: "numlist", default: [8, 6, 4, 2], help: "one per line, the same on every question in the set" },
    ...detailFields,
  ],
  input: { kind: "text", key: "text" },
  configSchema: config,
  answerSchema: answer,
  pool: (c) => c.poolId,
  stake: (c, used) => ({ key: "bet", label: "Confidence points", options: remaining(c.poolValues, used) }),
  score: (c, a) => (c.answers.some((x) => normalize(x) === normalize(a.text)) ? a.bet : 0),
  points: (c) => Math.max(...c.poolValues),
  fullPoints: (_c, a) => a.bet,
  publicView: (c) => ({ ...framePublic(c), question: c.question, poolId: c.poolId }),
  solution: (c) => c.answers[0] ?? "",
};
