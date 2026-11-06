import type { ZodType } from "zod";

export interface TriviaModule<C = any, A = any> {
  type: string;
  label: string;
  description: string;
  configSchema: ZodType<C>;
  answerSchema: ZodType<A>;
  /** Pure. Returns points awarded; 0 means wrong. */
  score(config: C, answer: A): number;
}

export const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
