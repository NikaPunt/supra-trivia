import { z } from "zod";
import { QUESTION_MAX, detailFields, frameShape, normalize, type TriviaModule } from "./types.js";

const config = z.object({
  ...frameShape,
  category: z.string().min(1).max(100),
  question: z.string().min(1).max(QUESTION_MAX),
  answers: z.array(z.string().min(1).max(200)).min(1).max(20),
  maxWager: z.number().int().min(1).max(1000).default(20),
});
const answer = z.object({ text: z.string().min(1).max(200), wager: z.number().int().min(0).max(1000) });

/**
 * Final Jeopardy: players see only the category and lock in a wager, then the host shows the question and they answer.
 * The wager is kept by the server, so the answer a player sends never carries one that could be altered.
 */
export const jeopardy: TriviaModule<z.infer<typeof config>, z.infer<typeof answer>> = {
  type: "jeopardy",
  label: "Final Jeopardy",
  description: "Players see the category and wager first; you then show the question. Right wins the wager, wrong loses it.",
  fields: [
    { key: "category", label: "Category", kind: "text", placeholder: "Reality TV" },
    { key: "question", label: "Question (hidden until you show it)", kind: "textarea", placeholder: "In the Mafia-style reality show The Traitors, a murder is carried out by touching one worn item.\n\nWhat item was it?" },
    { key: "answers", label: "Answer", kind: "list", help: "the answer first, then any other spellings, one per line", placeholder: "Brooch" },
    { key: "maxWager", label: "Maximum wager", kind: "number", default: 20 },
    ...detailFields,
  ],
  input: { kind: "text", key: "text" },
  twoStep: { max: (c) => c.maxWager },
  configSchema: config,
  answerSchema: answer,
  score: (c, a) => (c.answers.some((x) => normalize(x) === normalize(a.text)) ? a.wager : a.wager ? -a.wager : 0),
  points: (c) => c.maxWager,
  fullPoints: (_c, a) => a.wager,
  wrongPoints: (_c, a) => (a.wager ? -a.wager : 0),
  publicView: (c, clueShown) => ({
    // The question box shows the category until the host shows the question.
    question: clueShown ? `Category: ${c.category}\n\n${c.question}` : `Category: ${c.category}\n\nPlace your wager.`,
    category: c.category,
    maxWager: c.maxWager,
  }),
  solution: (c) => c.answers[0] ?? "",
};
