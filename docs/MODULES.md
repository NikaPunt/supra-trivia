# Modules

A trivia is an ordered list of **rounds**. Each round is an ordered list of **modules**, which are the building blocks the host drags into the builder.
Every module is one file in `src/modules/` and registered in `src/modules/index.ts`.

## Contract

| Part | Purpose |
|------|---------|
| `type` | Stable id stored in the database, e.g. `text_qa` |
| `label`, `description` | Shown in the builder palette |
| `fields` | Form fields the builder renders for the host (`text`, `textarea`, `number`, `list`, `index`). No UI code is needed |
| `input` | How players answer: `text`, `choice` or `number`, and whether several answers are allowed (`multi`) |
| `configSchema` | zod schema validating what the host enters. Validation runs on every save |
| `answerSchema` | zod schema validating what a player submits |
| `score(config, answer)` | Returns points awarded (0 means wrong). Must be pure |
| `scoreAll` (optional) | Scores all answers together, e.g. closest-wins |
| `points(config)` | Points a host-approved answer earns |
| `publicView(config)` | What players see while the question is live. Must never contain the answer |
| `solution(config)` | The answer text shown at reveal |

Config is validated on the server.

The builder (`public/js/builder.js`) is generic: it reads `fields` from `/api/modules`, so drag-and-drop, forms and validation work for any new module automatically. The server never trusts client-side validation.

## Built-in modules

Point values are set per question in the builder and may be in halves (e.g. 1.5). Every module's `points` field defaults to 1 (theme guess bonus: 2).

### `text_qa` - Question and answer
Host enters a question, the accepted answers (case and punctuation insensitive) and points. Players type a short answer.

### `multiple_choice` - Multiple choice
Host enters a question, 2 to 6 options, which option is correct, and points. Players pick one.

### `theme_guess` - Theme guess
Host enters a hidden theme and a hint. Players may guess the theme during a round and the host approves or rejects each guess for bonus points.
Guesses are held for the current question only and capped at 5 per player (see BUG-001 in `BUGS.md`). Exact matches are auto-approved at reveal.

### `numeric_closest` - Closest number
Host enters a question and the true number. The closest guess wins the points.

## Adding a module

1. Create `src/modules/<type>.ts` exporting a `TriviaModule`.
2. Register it in `src/modules/index.ts`.
3. Add a section above and a test in `test/modules.test.ts`.
