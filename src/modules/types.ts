import type { ZodType } from "zod";

/** One editable setting in the builder. The builder renders its form from these, so a module needs no UI code. */
export interface Field {
  key: string;
  label: string;
  /** `list` is one entry per line; `index` is a 1-based number shown to hosts and stored 0-based. */
  kind: "text" | "textarea" | "number" | "list" | "index";
  default?: unknown;
  help?: string;
}

/** How players answer: a text box, one of the listed options, or a number. `key` is the field in the answer object. */
export interface ModuleInput {
  kind: "text" | "choice" | "number";
  key: string;
  /** Allow several answers per question (e.g. theme guesses). Capped by the engine. */
  multi?: boolean;
}

export interface TriviaModule<C = any, A = any> {
  type: string;
  label: string;
  description: string;
  fields: Field[];
  input: ModuleInput;
  configSchema: ZodType<C>;
  answerSchema: ZodType<A>;
  /** Pure. Returns points awarded; 0 means wrong. */
  score(config: C, answer: A): number;
  /** Optional. Scores all answers together, e.g. closest-wins. Replaces `score` when present. */
  scoreAll?(config: C, answers: { playerId: string; value: A }[]): Map<string, number>;
  /** Points a host-approved answer earns. */
  points(config: C): number;
  /** What players may see while the question is live. Must never contain the answer. */
  publicView(config: C): Record<string, unknown>;
  /** The answer, shown after the reveal. */
  solution(config: C): string;
}

export const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export const pointsField: Field = { key: "points", label: "Points", kind: "number", default: 1 };
