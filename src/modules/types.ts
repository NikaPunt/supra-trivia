import { z, type ZodType } from "zod";

/** One editable setting in the builder. The builder renders its form from these, so a module needs no UI code. */
export interface Field {
  key: string;
  label: string;
  /** `list` is one text per line; `numlist` one number per line; `index` is 1-based for hosts and stored 0-based. */
  kind: "text" | "textarea" | "number" | "list" | "numlist" | "index" | "select" | "checkbox";
  default?: unknown;
  help?: string;
  options?: string[];
  /** Left out of the saved config when blank. */
  optional?: boolean;
  /** Example text shown in the empty box, to show hosts what a good entry looks like. */
  placeholder?: string;
  /** Tucked under "More options" in the builder. */
  advanced?: boolean;
}

/** How players answer: a text box, one of the listed options, or a number. `key` is the field in the answer object. */
export interface ModuleInput {
  kind: "text" | "choice" | "number";
  key: string;
  /** Allow several answers per question. Capped by the engine. */
  multi?: boolean;
}

/** A value players stake on an answer (confidence points, a final wager). */
export interface Stake {
  key: string;
  label: string;
  /** Fixed values to choose from. Otherwise any number from min to max. */
  options?: number[];
  min?: number;
  max?: number;
}

export interface TriviaModule<C = any, A = any> {
  type: string;
  label: string;
  description: string;
  fields: Field[];
  input: ModuleInput;
  configSchema: ZodType<C>;
  answerSchema: ZodType<A>;
  /** Pure. Returns points awarded; 0 means wrong (a wager may be negative). */
  score(config: C, answer: A): number;
  /** Optional. Scores all answers together, e.g. closest-wins. Replaces `score` when present. */
  scoreAll?(config: C, answers: { playerId: string; value: A }[]): Map<string, number>;
  /** Points a host-approved answer earns. */
  points(config: C): number;
  /** Per-answer override of the "Right" button, when the value depends on the answer (a stake). */
  fullPoints?(config: C, answer: A): number;
  /** Per-answer override of the "Wrong" button (a lost wager is negative). */
  wrongPoints?(config: C, answer: A): number;
  /** If set, players also stake something on their answer. `used` are values already spent in the same pool. */
  stake?(config: C, used: number[]): Stake;
  /** Questions sharing a pool can each spend a given stake value only once per player. */
  pool?(config: C): string | undefined;
  /** Two-step questions (Final Jeopardy): players wager on the category alone, then the host shows the question. */
  twoStep?: { max(config: C): number };
  /** What players may see while the question is live. Must never contain the answer. `clueShown` is false until a two-step question is shown. */
  publicView(config: C, clueShown?: boolean): Record<string, unknown>;
  /** The answer, shown after the reveal. */
  solution(config: C): string;
}

export const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---- shared pieces ----
// A question is one box of text and an answer. Clues, answer types and tiers are guidance for the person
// writing the trivia (docs/GUIDELINES.md), not extra boxes, so players only ever see the question as written.

export const frameShape = {
  funFact: z.string().max(600).optional(),
};

/** Shown with the answer at the reveal. Optional, tucked away. */
export const detailFields: Field[] = [
  { key: "funFact", label: "Fun fact shown at the reveal", kind: "textarea", optional: true, advanced: true },
];

export const pointsField: Field = { key: "points", label: "Points", kind: "number", default: 1, help: "halves allowed, e.g. 1.5" };
export const pointsSchema = z.number().min(0).max(1000).multipleOf(0.5);

export const QUESTION_MAX = 1200;

/** Numbers in questions and answers stay within what floating-point arithmetic handles without rounding surprises. */
export const NUMBER_LIMIT = 1e15;
