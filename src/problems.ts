import type { z } from "zod";
import { getModule } from "./modules/index.js";

/** One thing wrong with a trivia that was sent to be saved, in words the host can act on. */
export type Problem = {
  /** Zero-based round and question the problem is in; question is null for a problem with the round or the trivia itself. */
  round: number | null;
  question: number | null;
  /** The key of the box (e.g. "answers"), when one box is the problem. */
  field: string | null;
  /** The whole sentence, naming where it is. */
  message: string;
  /** The same sentence without the place, for showing on the question itself. */
  detail: string;
};

const MAX_PROBLEMS = 20;
const label = (s: string) => s.replace(/\s*\(.*\)\s*$/, "");
const num = (n: unknown) => (typeof n === "bigint" ? Number(n) : (n as number));
const rec = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});

/** True when a question has nothing written in it at all: no text and no list entries. */
export function isBlankConfig(config: unknown): boolean {
  const texts: unknown[] = [];
  for (const v of Object.values(rec(config))) {
    if (typeof v === "string") texts.push(v);
    else if (Array.isArray(v)) texts.push(...v.filter((x) => typeof x === "string"));
  }
  return !texts.some((t) => String(t).trim() !== "");
}

function boxMessage(name: string, issue: z.core.$ZodIssue): string {
  const i = issue as any;
  const p = rec(i.params);
  const code = String(p.zod ?? i.code);
  const origin = String(p.origin ?? i.origin ?? "");
  const min = num(p.minimum ?? i.minimum), max = num(p.maximum ?? i.maximum);
  if (code === "too_small") {
    if (origin === "string") return min <= 1 ? `${name} is empty.` : `${name} is too short (at least ${min} characters).`;
    if (origin === "array") return min <= 1 ? `${name} needs at least one entry.` : `${name} needs at least ${min} entries.`;
    return `${name} must be at least ${min}.`;
  }
  if (code === "too_big") {
    if (origin === "string") return `${name} is too long (${max} characters at most).`;
    if (origin === "array") return `${name} has too many entries (${max} at most).`;
    return `${name} must be at most ${max}.`;
  }
  if (code === "invalid_type") return `${name} is missing or has the wrong kind of value.`;
  return `${name}: ${i.message}`;
}

const OTHER_BOXES: Record<string, string> = { section: "Section name", maxGuesses: "Number of guesses", timeLimit: "Time limit" };

/**
 * Turns the raw validation failure for a trivia into plain sentences that say which question and which box.
 * A question with nothing written in it is reported once, as an empty question, instead of once per box.
 */
export function describeProblems(raw: unknown, error: z.ZodError): { error: string; problems: Problem[] } {
  const rounds = Array.isArray(rec(raw).rounds) ? (rec(raw).rounds as unknown[]) : [];
  const roundName = (ri: number) => {
    const t = rec(rounds[ri]).title;
    return typeof t === "string" && t.trim() ? t.trim() : `Round ${ri + 1}`;
  };
  const moduleOf = (ri: number, mi: number) => rec(Array.isArray(rec(rounds[ri]).modules) ? (rec(rounds[ri]).modules as unknown[])[mi] : undefined);
  const where = (ri: number, mi: number) => {
    const def = getModule(String(moduleOf(ri, mi).type));
    return `${roundName(ri)}, question ${mi + 1}${def ? ` (${def.label})` : ""}`;
  };

  const out: Problem[] = [];
  const blankDone = new Set<string>();
  const add = (round: number | null, question: number | null, field: string | null, where: string | null, detail: string) =>
    out.push({ round, question, field, message: where ? `${where}: ${detail}` : detail, detail });

  for (const issue of error.issues) {
    const path = issue.path;
    if (path[0] === "title") {
      add(null, null, "title", null, boxMessage("The trivia title", issue));
    } else if (path[0] === "settings") {
      add(null, null, String(path[1] ?? ""), null, boxMessage(`Setting "${String(path[1] ?? "")}"`, issue));
    } else if (path[0] === "rounds" && path.length === 1) {
      add(null, null, null, null, "A trivia can have at most 30 rounds.");
    } else if (path[0] === "rounds" && typeof path[1] === "number") {
      const ri = path[1];
      if (path.length === 3 && path[2] === "title") add(ri, null, "title", null, boxMessage(`The title of ${roundName(ri)}`, issue).replace(/^The title of (Round \d+) is empty\.$/, "$1 needs a title."));
      else if (path[2] === "modules" && path.length === 3) add(ri, null, null, null, `${roundName(ri)} has too many questions (50 at most).`);
      else if (path[2] === "modules" && typeof path[3] === "number") {
        const mi = path[3];
        const w = where(ri, mi);
        const config = moduleOf(ri, mi).config;
        if (path[4] === "config" && isBlankConfig(config)) {
          const key = `${ri}:${mi}`;
          if (!blankDone.has(key)) {
            blankDone.add(key);
            add(ri, mi, null, w, "this question is empty. Fill it in, or remove it with the ✕ button.");
          }
        } else if (path[4] === "config" && typeof path[5] === "string") {
          const def = getModule(String(moduleOf(ri, mi).type));
          const f = def?.fields.find((x) => x.key === path[5]);
          add(ri, mi, String(path[5]), w, boxMessage(f ? `"${label(f.label)}"` : `"${String(path[5])}"`, issue));
        } else if (path[4] === "config") {
          add(ri, mi, null, w, issue.message);
        } else if (typeof path[4] === "string" && OTHER_BOXES[path[4]]) {
          add(ri, mi, path[4], w, boxMessage(`"${OTHER_BOXES[path[4]]}"`, issue));
        } else if (path[4] === "type") {
          add(ri, mi, null, w, issue.message);
        } else {
          add(ri, mi, null, w, issue.message);
        }
      } else add(ri, null, null, null, `${roundName(ri)}: ${issue.message}`);
    } else {
      add(null, null, null, null, issue.message);
    }
  }
  const shown = out.slice(0, MAX_PROBLEMS);
  const head = shown.slice(0, 3).map((p) => p.message).join(" ");
  const rest = out.length - Math.min(3, out.length);
  return { error: `${head}${rest > 0 ? ` (and ${rest} more)` : ""}`.trim() || "The trivia is not valid.", problems: shown };
}
