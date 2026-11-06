import { readFileSync } from "node:fs";
import { z } from "zod";
import { roundsSchema, settingsSchema } from "./modules/index.js";

const sampleSchema = z.object({ title: z.string().min(1).max(120), settings: settingsSchema, rounds: roundsSchema });
export type Sample = z.infer<typeof sampleSchema>;

/**
 * The trivia every host starts with, so there is a worked example of how a trivia is built.
 * It is public/starter.json, the same file the builder's "Load sample trivia" button uses.
 */
export function loadSample(path = new URL("../public/starter.json", import.meta.url)): Sample | null {
  try {
    return sampleSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (e) {
    console.error("the sample trivia could not be loaded, so new hosts will not get one:", (e as Error).message);
    return null;
  }
}
