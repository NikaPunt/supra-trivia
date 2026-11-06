# Known bugs

## Open

_None._

## Carried over from Trivia 0.1

### BUG-001: Theme guesses never clear and drag every guess down
- **Seen in:** 0.1 (`server/Start-TriviaServer.ps1`, `/api/state` around line 549, `themeGuesses` in game state).
- **Symptom:** Theme guesses are never removed. The list for a team keeps growing as more people guess, which slows every request and pushes every team's guesses further down the list.
- **Cause:** `themeGuesses` is one flat array for the whole event. `/api/state` returns every guess for the team, and nothing drops them when the question advances or the theme is solved.
- **0.2 design requirement:** Guesses belong to a session and a round. Only the current round's pending guesses go to the host, players only receive their own latest guess, and guesses are archived out of live state when the round closes. A cap per player per round applies. Status: **fixed in 0.2** by design, covered by tests in `test/auth.test.ts` and `test/game.test.ts`. Answers live only for the current question (`Game.answers` in `src/game.ts`), are capped by the guess limit, and are scored into a running total then dropped when the host moves on. Secret-theme guesses are capped at 5 per player and cleared when the theme is revealed.

### BUG-002: Scores visibly go up when a player answers correctly, encouraging repeated guessing
- **Seen in:** 0.1 live scoreboard. The score updated as soon as an answer was marked correct, so players could see a guess land and keep guessing until it did.
- **Symptom:** Players guess over and over until their score moves. That turns a question into brute force, which isn't respectable trivia.
- **0.2 fix, status: fixed:**
  - Players receive no right/wrong status, points or leaderboard until the host **reveals** the question. This is enforced in `playerView` (`src/game.ts`), so it holds even when the host awards points by hand mid-question.
  - Guesses are limited per player per question (see `docs/SCORING.md`).
  - Scoreboards only appear at the end of a round and the end of the game, and theme bonuses stay hidden until the theme is revealed.
  - Covered by the "BUG-002" test in `test/auth.test.ts`.
