import { test } from "node:test";
import assert from "node:assert/strict";
import { getModule, roundsSchema } from "../src/modules/index.js";

test("text_qa ignores case and punctuation", () => {
  const m = getModule("text_qa")!;
  const c = m.configSchema.parse({ question: "Capital of France?", answers: ["Paris"], points: 2 });
  assert.equal(m.score(c, { text: " paris! " }), 2);
  assert.equal(m.score(c, { text: "Lyon" }), 0);
});

test("multiple_choice rejects out-of-range correct index", () => {
  const m = getModule("multiple_choice")!;
  assert.equal(m.configSchema.safeParse({ question: "q", options: ["a", "b"], correct: 2 }).success, false);
  const c = m.configSchema.parse({ question: "q", options: ["a", "b"], correct: 1 });
  assert.equal(m.score(c, { choice: 1 }), 1);
  assert.equal(m.score(c, { choice: 0 }), 0);
});

test("roundsSchema rejects unknown module types and bad config", () => {
  assert.equal(roundsSchema.safeParse([{ title: "r", modules: [{ type: "nope", config: {} }] }]).success, false);
  assert.equal(roundsSchema.safeParse([{ title: "r", modules: [{ type: "text_qa", config: {} }] }]).success, false);
  assert.equal(
    roundsSchema.safeParse([{ title: "r", modules: [{ type: "text_qa", config: { question: "q", answers: ["a"] } }] }]).success,
    true,
  );
});
