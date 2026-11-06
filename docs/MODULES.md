# Question types (modules)

A trivia is an ordered list of **rounds**; each round is an ordered list of **questions**, and each question is one of these types. Rounds have a title and a description for the rules of their special categories. A question can carry a **section** label (e.g. "Hodgepodge", "Before & After", "Confidence Set").
Every type is one file in `src/modules/` registered in `src/modules/index.ts`.

## What every question has (the question frame)
These follow [GUIDELINES.md](GUIDELINES.md). All are optional, and the builder suggests filling them in:

| Field | Purpose |
|---|---|
| Clue 1 | The harder, clever enthusiast angle |
| Clue 2 | The broader foothold so casual players have an angle |
| Answer type | Pinned on screen ("Country", "Person", "Film") to avoid grading disputes |
| Category | Rotate sub-genres across history, science, geography, food, pop culture |
| Tier | Layup, Sweet Spot, Stretch or Separator, for the 2-5-2-1 meter |
| Fun fact | Shown at the reveal ("why" / the deduction) |

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
1. Create `src/modules/<type>.ts` exporting a `TriviaModule`; spread `clueFields` and `detailFields` into its `fields` so it gets the question frame.
2. Register it in `src/modules/index.ts`.
3. Add a row above and a test in `test/`.

The builder is generic: it reads `fields` from `/api/modules`, so drag-and-drop, forms and validation work for new types automatically.

## Bringing over a 0.1 trivia
```bash
node tools/convert-v01.mjs path/to/questions.json > my-trivia.json
```
Then use **Import JSON** in the builder. The converter keeps rounds, sections, clues, answer types, accepted answers, fun facts, confidence sets, Final Jeopardy and the secret theme.
