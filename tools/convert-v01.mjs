#!/usr/bin/env node
// Converts a Trivia 0.1 event (questions.json) into a 0.2 trivia you can import in the builder.
//   node tools/convert-v01.mjs path/to/questions.json > my-trivia.json
import { readFileSync } from "node:fs";

const src = JSON.parse(readFileSync(process.argv[2], "utf8"));
const TIERS = new Set(["Layup", "Sweet Spot", "Stretch", "Separator"]);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));
const uniq = (xs) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];

function frame(q) {
  // 0.1 events used either clue1/clue2 or a single `text` prompt; keep whichever is there.
  return clean({
    category: q.category,
    answerType: q.answerType,
    tier: TIERS.has(q.tier) ? q.tier : undefined,
    clue1: q.clue1 ?? q.text,
    clue2: q.clue2,
    funFact: q.funFact,
  });
}

function convert(q) {
  const answers = uniq([q.answer, ...(q.acceptedAnswers ?? [])]);
  const base = { ...frame(q), question: q.questionPrompt || q.text || "?", answers };
  const section = q.sectionTitle || undefined;
  switch (q.mechanic) {
    case "confidence":
      return { type: "confidence", section, config: { ...base, poolId: q.poolId || "confidence", poolValues: q.poolValues ?? [8, 6, 4, 2] } };
    case "jeopardy":
      return { type: "wager", section, config: { ...base, maxWager: q.points ?? 20 } };
    default:
      return { type: "text_qa", section, config: { ...base, points: q.points ?? 1 } };
  }
}

const trivia = {
  title: src.title || "Imported trivia",
  settings: {
    maxGuesses: 3,
    ...(src.theme ? { theme: { secret: src.theme, hint: "", formal: src.formalTheme || "" } } : {}),
  },
  rounds: (src.rounds ?? []).map((r) => ({
    title: r.title,
    ...(r.subtitle ? { subtitle: r.subtitle } : {}),
    modules: (r.questions ?? []).map((q) => clean(convert(q))),
  })),
};
process.stdout.write(JSON.stringify(trivia, null, 2) + "\n");
