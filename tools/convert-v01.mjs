#!/usr/bin/env node
// Converts a Trivia 0.1 event (questions.json) into a 0.2 trivia you can import in the builder.
//   node tools/convert-v01.mjs path/to/questions.json > my-trivia.json
import { readFileSync } from "node:fs";

const src = JSON.parse(readFileSync(process.argv[2], "utf8"));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));
const uniq = (xs) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];

/** One question box: the clue(s) first, then the ask on its own line, the way it is read out. */
function questionText(q) {
  const body = [q.clue1 ?? q.text, q.clue2].filter(Boolean).map((t) => String(t).trim()).join(" ");
  const ask = String(q.questionPrompt ?? "").trim();
  return [body, ask].filter(Boolean).join("\n\n") || "?";
}

function convert(q) {
  const answers = uniq([q.answer, ...(q.acceptedAnswers ?? [])]);
  const base = { question: questionText(q), answers, funFact: q.funFact };
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
    modules: (r.questions ?? []).map((q) => clean(convert(q))),
  })),
};
process.stdout.write(JSON.stringify(trivia, null, 2) + "\n");
