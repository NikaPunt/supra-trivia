# Modules

A trivia is an ordered list of **rounds**. Each round is an ordered list of **modules**, which are the building blocks the host drags into the builder.
Every module is one file in `src/modules/` and registered in `src/modules/index.ts`.

## Contract

| Part | Purpose |
|------|---------|
| `type` | Stable id stored in the database, e.g. `text_qa` |
| `label`, `description` | Shown in the builder palette |
| `configSchema` | zod schema validating what the host enters. Validation runs on every save |
| `answerSchema` | zod schema validating what a player submits |
| `score(config, answer)` | Returns points awarded (0 means wrong). Must be pure |

Config is validated on the server. The server never trusts client-side validation.

## Built-in modules

### `text_qa` - Question and answer
Host enters a question, the accepted answers (case and punctuation insensitive) and points. Players type a short answer.

### `multiple_choice` - Multiple choice
Host enters a question, 2 to 6 options, which option is correct, and points. Players pick one.

### `theme_guess` - Theme guess
Host enters a hidden theme and a hint. Players may guess the theme during a round and the host approves or rejects each guess for bonus points.
Guesses are scoped to the round (see BUG-001 in `BUGS.md`).

### `numeric_closest` - Closest number
Host enters a question and the true number. The closest guess wins the points.

## Adding a module

1. Create `src/modules/<type>.ts` exporting a `TriviaModule`.
2. Register it in `src/modules/index.ts`.
3. Add a section above and a test in `test/modules.test.ts`.
