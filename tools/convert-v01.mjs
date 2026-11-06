#!/usr/bin/env node
// Converts a Trivia 0.1 event (questions.json) into a 0.2 trivia you can import in the builder.
//   node tools/convert-v01.mjs path/to/questions.json > my-trivia.json
import { readFileSync } from "node:fs";

const src = JSON.parse(readFileSync(process.argv[2], "utf8"));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && v !== null));
const uniq = (xs) => [...new Set(xs.map((x) => String(x).trim()).filter(Boolean))];

const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));
const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * One question box, the way it is read out: whatever the clue is (text, a numbered list of steps, the cast and year,
 * a puzzle board, a list of tracks), then the ask on its own line. Nothing a player needs is left behind.
 */
function questionText(q) {
  const lines = [];
  // Confidence questions are picked by category, so it leads.
  if (q.mechanic === "confidence" && q.category) lines.push(`Category: ${q.category}`);
  const body = [q.clue1 ?? q.text, q.clue2].filter(Boolean).map((t) => String(t).trim()).join(" ");
  if (body) lines.push(body);
  if (Array.isArray(q.steps)) q.steps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  if (Array.isArray(q.cast) && q.cast.length) lines.push(`Starring ${list(q.cast)}.${q.releaseYear ? ` Released in ${q.releaseYear}.` : ""}`);
  else if (q.releaseYear) lines.push(`Released in ${q.releaseYear}.`);
  if (q.puzzleBoard) lines.push(q.puzzleBoard);
  if (Array.isArray(q.tracks) && q.tracks.length) lines.push(`Tracks: ${q.tracks.map((t) => `"${t}"`).join(", ")}.`);
  const ask = String(q.questionPrompt ?? "").trim();
  if (ask) lines.push(ask);
  return lines.join("\n\n") || "?";
}

/** The real answer first (it is what players are shown), then other spellings, without repeats that differ only by case. */
function answersOf(q) {
  const out = [];
  for (const a of [q.answer, ...(q.acceptedAnswers ?? [])]) {
    const t = String(a).trim();
    if (t && !out.some((x) => norm(x) === norm(t))) out.push(t);
  }
  return out;
}

function convert(q) {
  const answers = answersOf(q);
  const base = { question: questionText(q), answers, funFact: q.funFact };
  const section = q.sectionTitle || undefined;
  switch (q.mechanic) {
    case "confidence":
      return { type: "confidence", section, config: { ...base, poolId: q.poolId || "confidence", poolValues: q.poolValues ?? [8, 6, 4, 2] } };
    case "jeopardy":
      // Players wager on the category alone, then the question is shown. Any note in brackets after the category is dropped.
      return { type: "jeopardy", section, config: { ...base, category: String(q.category ?? "Final").replace(/\s*\(.*\)\s*$/, "").trim() || "Final", maxWager: q.points ?? 20 } };
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
