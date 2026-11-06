import { z, type ZodType } from "zod";

/** One editable setting in the builder. The builder renders its form from these, so a module needs no UI code. */
export interface Field {
  key: string;
  label: string;
  /** `list` is one text per line; `numlist` one number per line; `index` is 1-based for hosts and stored 0-based. */
  kind: "text" | "textarea" | "number" | "list" | "numlist" | "index" | "select";
  default?: unknown;
  help?: string;
  options?: string[];
  /** Left out of the saved config when blank. */
  optional?: boolean;
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
  /** What players may see while the question is live. Must never contain the answer. */
  publicView(config: C): Record<string, unknown>;
  /** The answer, shown after the reveal. */
  solution(config: C): string;
}

export const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---- shared question frame, from the trivia guidelines (docs/GUIDELINES.md) ----

export const TIERS = ["Layup", "Sweet Spot", "Stretch", "Separator"] as const;

export const frameShape = {
  category: z.string().max(60).optional(),
  answerType: z.string().max(60).optional(),
  tier: z.enum(TIERS).optional(),
  clue1: z.string().max(600).optional(),
  clue2: z.string().max(600).optional(),
  funFact: z.string().max(600).optional(),
};

/** The two-clue pinning rule: a sharper clue for enthusiasts first, then a broader foothold. */
export const clueFields: Field[] = [
  { key: "clue1", label: "Clue 1: the enthusiast angle", kind: "textarea", optional: true, help: "harder, clever" },
  { key: "clue2", label: "Clue 2: the accessible foothold", kind: "textarea", optional: true, help: "broader context" },
];

export const detailFields: Field[] = [
  { key: "answerType", label: "Answer type (pinned on screen)", kind: "text", optional: true, help: "e.g. Country, Person, Film" },
  { key: "category", label: "Category", kind: "text", optional: true, help: "rotate sub-genres" },
  { key: "tier", label: "Tier", kind: "select", options: [...TIERS], optional: true, help: "for the 2-5-2-1 curve" },
  { key: "funFact", label: "Fun fact / why (shown at reveal)", kind: "textarea", optional: true },
];

export const pointsField: Field = { key: "points", label: "Points", kind: "number", default: 1, help: "halves allowed, e.g. 1.5" };
export const pointsSchema = z.number().min(0).max(1000).multipleOf(0.5);

/** What every player may see about the question's framing. Never includes the answer. */
export const framePublic = (c: z.infer<z.ZodObject<typeof frameShape>>) => ({
  category: c.category, answerType: c.answerType, tier: c.tier, clue1: c.clue1, clue2: c.clue2,
});
