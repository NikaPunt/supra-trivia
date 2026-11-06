# Question types (modules)

A trivia is an ordered list of **rounds**; each round is an ordered list of **questions**, and each question is one of these types. Rounds have a title and a description for the rules of their special categories. A question can carry a **section** label (e.g. "Hodgepodge", "Before & After", "Confidence Set").
Every type is one file in `src/modules/` registered in `src/modules/index.ts`.

## What a question is
One box of text, an answer, and points. Players see exactly the text you wrote, with blank lines kept, so a question can end with its ask on a line of its own. There are no separate clue, category, tier or answer-type boxes: the quality advice in [GUIDELINES.md](GUIDELINES.md) is for the person writing the trivia. Under **More options** a question can also have a **section**, a fun fact shown at the reveal, and its own guess limit.

The header above a question reads `Round 1: Hodgepodge · 1/6`. The count is over consecutive questions of the same section, so six Hodgepodge questions are 1/6 to 6/6 and a four-question confidence set is 1/4 to 4/4.

## Built-in types

| Type | How it works |
|---|---|
| **Question and answer** (`text_qa`) | Players type a short answer. Accepted answers ignore case and punctuation. Points per question, in halves |
| **Multiple choice** (`multiple_choice`) | 2-6 options. Good for Odd One Out and Two Truths & a Lie |
| **Closest number** (`numeric_closest`) | The closest guess wins, ties share. The classic tie-breaking **Separator** ("closest without going over" style triangulation) |
| **Confidence set** (`confidence`) | Questions sharing a *pool name* and values (e.g. 8, 6, 4, 2). Each player spends each value once, on the question they feel surest about. Right earns the value |
| **Final wager** (`wager`) | Players wager up to a maximum. Right wins the wager, wrong loses it |

The **secret overall theme** is not a question type: it is a setting of the whole trivia (see [SCORING.md](SCORING.md)).

## The module contract
| Part | Purpose |
|---|---|
| `type`, `label`, `description` | Shown in the builder palette |
| `fields` | Form fields the builder renders (`text`, `textarea`, `number`, `list`, `numlist`, `index`, `select`). No UI code needed |
| `input` | How players answer: `text`, `choice` or `number` |
| `configSchema` / `answerSchema` | zod schemas. The server validates every save and every answer |
| `score(config, answer)` | Pure; points awarded (0 wrong; a wager may be negative) |
| `scoreAll` (optional) | Score all answers together, e.g. closest-wins |
| `points(config)` | What an approved answer earns |
| `stake`, `pool` (optional) | Players stake a value on their answer (confidence points, a wager), optionally from a pool spent once |
| `fullPoints`, `wrongPoints` (optional) | What the host's Right / Wrong buttons award when it depends on the answer |
| `publicView(config)` | What players may see while the question is live. Must never contain the answer |
| `solution(config)` | The answer text shown at the reveal |

## Adding a type
1. Create `src/modules/<type>.ts` exporting a `TriviaModule`; give each field a `placeholder` that shows a good example, and spread `detailFields` into `fields` for the fun fact.
2. Register it in `src/modules/index.ts`.
3. Add a row above and a test in `test/`.

The builder is generic: it reads `fields` from `/api/modules`, so drag-and-drop, forms and validation work for new types automatically.

## Bringing over a 0.1 trivia
```bash
node tools/convert-v01.mjs path/to/questions.json > my-trivia.json
```
Then use **Import JSON** in the builder. The converter keeps rounds, sections, the question (the clues and the ask become one text, including numbered steps, the cast and year, puzzle boards and track lists), accepted answers, fun facts, confidence sets (each led by its category), Final Jeopardy and the secret theme. Trivias saved with the older separate clue boxes are folded into one question automatically.
