import { z } from "zod";
import { answerText, QUESTION_MAX, detailFields, frameShape, normalize, pointsSchema, type TriviaModule } from "./types.js";

/** The most things a player can be asked to list. */
export const NSOME_MAX = 10;

const config = z.object({
  ...frameShape,
  question: z.string().min(1).max(QUESTION_MAX),
  /** How many things players list: 3 is a threesome. */
  count: z.number().int().min(2).max(NSOME_MAX).default(3),
  /** Every item that counts as right. May hold more than `count` ("name three Beatles" with four accepted). */
  answers: z.array(answerText).min(1).max(30),
  /** Points for each correct item. */
  points: pointsSchema.default(1),
  /** Extra points when all of the `count` items are right. */
  bonus: pointsSchema.default(2),
  /** One extra box for anything else a player is thinking of. It never scores by itself: the host can award points by hand. */
  catchall: z.boolean().default(false),
});
const answer = z.object({
  items: z.array(answerText).min(1).max(NSOME_MAX),
  extra: answerText.optional(),
});

type Config = z.infer<typeof config>;

/** How many different listed items match an accepted answer. Order and repeats make no difference. */
function correctCount(c: Config, a: z.infer<typeof answer>): number {
  const accepted = new Set(c.answers.map(normalize));
  const seen = new Set<string>();
  for (const item of a.items.slice(0, c.count)) {
    const n = normalize(item);
    if (accepted.has(n)) seen.add(n);
  }
  return seen.size;
}

export const nsome: TriviaModule<Config, z.infer<typeof answer>> = {
  type: "nsome",
  label: "N-some (list several)",
  description: "Players list a set number of things (a threesome is three). Each right one scores, with a bonus for getting them all.",
  fields: [
    { key: "question", label: "Question", kind: "textarea", placeholder: "Name three of the four Beatles." },
    { key: "count", label: "How many things players list", kind: "number", default: 3, help: "2 to 10" },
    { key: "answers", label: "Accepted answers", kind: "list", help: "one per line; any of these counts as right", placeholder: "John Lennon\nPaul McCartney\nGeorge Harrison\nRingo Starr" },
    { key: "points", label: "Points for each right item", kind: "number", default: 1, help: "halves allowed" },
    { key: "bonus", label: "Bonus for getting them all", kind: "number", default: 2, help: "halves allowed" },
    { key: "catchall", label: "Add a box for anything else", kind: "checkbox", default: false, help: "never scores by itself; you can award points by hand" },
    ...detailFields,
  ],
  input: { kind: "texts", key: "items" },
  configSchema: config,
  answerSchema: answer,
  partialCredit: true,
  check: (c, a) =>
    a.items.length > c.count ? `can list at most ${c.count} things`
    : a.extra !== undefined && !c.catchall ? "this question has no extra box" : undefined,
  score: (c, a) => {
    const right = correctCount(c, a);
    return right * c.points + (right >= c.count ? c.bonus : 0);
  },
  points: (c) => c.count * c.points + c.bonus,
  publicView: (c) => ({ question: c.question, count: c.count, catchall: c.catchall }),
  solution: (c) => c.answers.join(", "),
};
