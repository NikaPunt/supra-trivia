# Question types (modules)

A trivia is an ordered list of **rounds**; each round is an ordered list of **questions**, and each question is one of these types. A question can carry a **section** label (e.g. "Hodgepodge", "Before & After", "Confidence Set"); consecutive questions with the same section are numbered "1/6".
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
| **Confidence set** (`confidence`) | A run of confidence questions in the same section shares one list of values (e.g. 8, 6, 4, 2). Each player spends each value once, on the question they feel surest about. Right earns the value. See [Confidence sets](#confidence-sets-and-sections) |
| **Final wager (non-Jeopardy)** (`wager`) | Players see the question and send an answer and a wager together, up to a maximum. Right wins the wager, wrong loses it |
| **Final Jeopardy** (`jeopardy`) | The same scoring, but the wager comes first, before anyone sees the question. Players see only the **category** and lock in a wager (they can change it until you show the question); then you press **Show the question**, the answer clock starts, and they answer. The wager is kept by the server, so it cannot be altered once the question is up |

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

## Confidence sets and sections
A confidence set is **a run of confidence questions in a row, in the same round, with the same section name**. They share one list of values, each spendable once per team. There is no separate "pool name":
- A **different section name**, a **question of another type** in between, or a **new round** starts a new set. Two sets named "Confidence Set" with a question between them are two independent sets.
- The values are typed once, on the first question of the set. The rest show them read-only.
- A new Confidence block joins the one before it, or starts a section called "Confidence Set".

Foolproofing section names, which also keeps the "1/6" numbering from splitting:
- The Section box is a dropdown of the sections already in the trivia, plus **New section…**.
- Capitals and extra spaces make no difference. The first spelling wins, in the builder and on the server, so imported and older trivias are tidied too.
- Names that look like typos of each other ("Confidence Set" and "Confidence Sets") raise a card with a one-click "Use this spelling everywhere".
- Each run of same-section questions gets a bracket and a header ("Confidence set · 4 questions · values 8, 6, 4, 2"), so a split run shows as two headers. Warnings: one question in a set, more questions than values, more values than questions. They never stop you saving.
- Older trivias that named their pools by hand are read by section instead.
