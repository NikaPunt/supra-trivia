import { z } from "zod";
import type { TriviaModule } from "./types.js";
import { textQa } from "./text_qa.js";
import { multipleChoice } from "./multiple_choice.js";
import { numericClosest } from "./numeric_closest.js";
import { confidence } from "./confidence.js";
import { wager } from "./wager.js";
import { jeopardy } from "./jeopardy.js";

export const modules: TriviaModule[] = [textQa, multipleChoice, numericClosest, confidence, wager, jeopardy];
const byType = new Map(modules.map((m) => [m.type, m]));
export const getModule = (type: string) => byType.get(type);

/**
 * Older trivias had separate clue, answer type, category and tier boxes. Questions are one box now, so fold the
 * clues into the question (clues first, the ask last) and drop the rest.
 */
function upgradeLegacy(type: string, config: unknown): unknown {
  if (!config || typeof config !== "object") return config;
  const c = { ...(config as Record<string, unknown>) };
  const clues = [c.clue1, c.clue2].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (clues.length) {
    const ask = typeof c.question === "string" ? c.question.trim() : "";
    c.question = [clues.map((x) => x.trim()).join(" "), ask].filter(Boolean).join("\n\n");
  }
  // Final Jeopardy has a real "category"; on every other type it was only an old tag.
  for (const k of ["clue1", "clue2", "answerType", "tier", ...(type === "jeopardy" ? [] : ["category"])]) delete c[k];
  return c;
}

const moduleInstance = z
  .object({
    type: z.string(),
    config: z.unknown(),
    /** Group label inside a round, e.g. "Hodgepodge" or "Before & After". */
    section: z.string().max(60).optional(),
    maxGuesses: z.number().int().min(0).max(50).optional(),
    /** Seconds before answers close by themselves. 0 means no timer. Blank uses the trivia setting. */
    timeLimit: z.number().int().min(0).max(3600).optional(),
  })
  .transform((m, ctx) => {
    const mod = getModule(m.type);
    if (!mod) {
      ctx.addIssue({ code: "custom", message: `unknown question type: ${m.type}`, path: ["type"] });
      return z.NEVER;
    }
    const parsed = mod.configSchema.safeParse(upgradeLegacy(m.type, m.config));
    if (!parsed.success) {
      // One issue per box, placed at that box, so the host can be told exactly which question and which box.
      for (const i of parsed.error.issues) {
        const x = i as { code: string; origin?: string; minimum?: unknown; maximum?: unknown };
        ctx.addIssue({ code: "custom", message: i.message, path: ["config", ...i.path], params: { zod: x.code, origin: x.origin, minimum: x.minimum, maximum: x.maximum } });
      }
      return z.NEVER;
    }
    return { type: m.type, config: parsed.data, section: m.section, maxGuesses: m.maxGuesses, timeLimit: m.timeLimit };
  });

export const roundsSchema = z
  .array(
    z.object({
      title: z.string().min(1).max(100),
      modules: z.array(moduleInstance).max(50),
    }),
  )
  .max(30)
  .transform((rounds) => unifyPools(rounds));

/** How two names are compared: capitals and extra spaces make no difference. */
export const nameKey = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Two clean-ups that make sections impossible to split by accident:
 * - A section name is spelled once across the whole trivia: the first spelling wins ("hodgepodge " becomes "Hodgepodge").
 * - A confidence set is a run of neighbouring confidence questions in a round with the same section. Each run gets its own
 *   set, however old trivias named their pools, and every question in it offers the first question's values.
 * A different section, a question of another type, or a new round starts a new set.
 */
function unifyPools<T extends { modules: { type: string; section?: string; config: any }[] }>(rounds: T[]): T[] {
  const names = new Map<string, string>();
  for (const r of rounds) for (const m of r.modules) {
    if (m.section === undefined) continue;
    const clean = m.section.trim().replace(/\s+/g, " ");
    if (!clean) { m.section = undefined; continue; }
    m.section = names.get(nameKey(clean)) ?? (names.set(nameKey(clean), clean), clean);
  }
  rounds.forEach((r, ri) => {
    let head: { id: string; values: number[]; key: string } | null = null;
    r.modules.forEach((m, i) => {
      if (m.type !== "confidence") { head = null; return; }
      const key = nameKey(m.section ?? "");
      if (!head || head.key !== key) head = { id: `set-${ri}-${i}`, values: [...m.config.poolValues], key };
      m.config.poolId = head.id;
      m.config.poolValues = [...head.values];
    });
  });
  return rounds;
}

/** The secret overall theme that links the questions. Players guess it any time for bonus points. */
export const themeSchema = z.object({
  secret: z.string().min(1).max(200),
  hint: z.string().max(300).default(""),
  /** The full explanation shown when the theme is revealed. */
  formal: z.string().max(600).default(""),
  /** Points for finding the theme. The same for everyone, however early they guessed. */
  bonus: z.number().min(0.5).max(100).multipleOf(0.5).default(4),
});

export const settingsSchema = z.object({
  /** Guesses each player gets per question. 0 means unlimited (still capped by the engine). */
  maxGuesses: z.number().int().min(0).max(50).default(3),
  /** Seconds each question stays open before answers close by themselves. 0 means no timer. */
  timeLimit: z.number().int().min(0).max(3600).default(180),
  theme: themeSchema.optional(),
});
export type Settings = z.infer<typeof settingsSchema>;

export type Rounds = z.infer<typeof roundsSchema>;
