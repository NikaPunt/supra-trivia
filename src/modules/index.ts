import { z } from "zod";
import type { TriviaModule } from "./types.js";
import { textQa } from "./text_qa.js";
import { multipleChoice } from "./multiple_choice.js";
import { numericClosest } from "./numeric_closest.js";
import { confidence } from "./confidence.js";
import { wager } from "./wager.js";

export const modules: TriviaModule[] = [textQa, multipleChoice, numericClosest, confidence, wager];
const byType = new Map(modules.map((m) => [m.type, m]));
export const getModule = (type: string) => byType.get(type);

/**
 * Older trivias had separate clue, answer type, category and tier boxes. Questions are one box now, so fold the
 * clues into the question (clues first, the ask last) and drop the rest.
 */
function upgradeLegacy(config: unknown): unknown {
  if (!config || typeof config !== "object") return config;
  const c = { ...(config as Record<string, unknown>) };
  const clues = [c.clue1, c.clue2].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (clues.length) {
    const ask = typeof c.question === "string" ? c.question.trim() : "";
    c.question = [clues.map((x) => x.trim()).join(" "), ask].filter(Boolean).join("\n\n");
  }
  for (const k of ["clue1", "clue2", "answerType", "category", "tier"]) delete c[k];
  return c;
}

const moduleInstance = z
  .object({
    type: z.string(),
    config: z.unknown(),
    /** Group label inside a round, e.g. "Hodgepodge" or "Before & After". */
    section: z.string().max(60).optional(),
    maxGuesses: z.number().int().min(0).max(50).optional(),
  })
  .transform((m, ctx) => {
    const mod = getModule(m.type);
    if (!mod) {
      ctx.addIssue({ code: "custom", message: `unknown module type: ${m.type}` });
      return z.NEVER;
    }
    const parsed = mod.configSchema.safeParse(upgradeLegacy(m.config));
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `${m.type}: ${parsed.error.message}` });
      return z.NEVER;
    }
    return { type: m.type, config: parsed.data, section: m.section, maxGuesses: m.maxGuesses };
  });

export const roundsSchema = z
  .array(
    z.object({
      title: z.string().min(1).max(100),
      modules: z.array(moduleInstance).max(50),
    }),
  )
  .max(30);

/** The secret overall theme that links the questions. Players guess it any time for bonus points. */
export const themeSchema = z.object({
  secret: z.string().min(1).max(200),
  hint: z.string().max(300).default(""),
  /** The full explanation shown when the theme is revealed. */
  formal: z.string().max(600).default(""),
});

export const settingsSchema = z.object({
  /** Guesses each player gets per question. 0 means unlimited (still capped by the engine). */
  maxGuesses: z.number().int().min(0).max(50).default(3),
  theme: themeSchema.optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

export type Rounds = z.infer<typeof roundsSchema>;
