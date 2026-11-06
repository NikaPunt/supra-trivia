import { z } from "zod";
import type { TriviaModule } from "./types.js";
import { textQa } from "./text_qa.js";
import { multipleChoice } from "./multiple_choice.js";
import { themeGuess } from "./theme_guess.js";
import { numericClosest } from "./numeric_closest.js";

export const modules: TriviaModule[] = [textQa, multipleChoice, themeGuess, numericClosest];
const byType = new Map(modules.map((m) => [m.type, m]));
export const getModule = (type: string) => byType.get(type);

const moduleInstance = z
  .object({ type: z.string(), config: z.unknown() })
  .transform((m, ctx) => {
    const mod = getModule(m.type);
    if (!mod) {
      ctx.addIssue({ code: "custom", message: `unknown module type: ${m.type}` });
      return z.NEVER;
    }
    const parsed = mod.configSchema.safeParse(m.config);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: `${m.type}: ${parsed.error.message}` });
      return z.NEVER;
    }
    return { type: m.type, config: parsed.data };
  });

export const roundsSchema = z
  .array(
    z.object({
      title: z.string().min(1).max(100),
      modules: z.array(moduleInstance).max(50),
    }),
  )
  .max(30);

export type Rounds = z.infer<typeof roundsSchema>;
