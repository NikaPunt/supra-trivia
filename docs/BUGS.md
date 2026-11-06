# Known bugs

## Open

_None._

## Carried over from Trivia 0.1

### BUG-001: Theme guesses never clear and drag every guess down
- **Seen in:** 0.1 (`server/Start-TriviaServer.ps1`, `/api/state` around line 549, `themeGuesses` in game state).
- **Symptom:** Theme guesses are never removed. The list for a team keeps growing as more people guess, which slows every request and pushes every team's guesses further down the list.
- **Cause:** `themeGuesses` is one flat array for the whole event. `/api/state` returns every guess for the team, and nothing drops them when the question advances or the theme is solved.
- **0.2 design requirement:** Guesses belong to a session and a round. Only the current round's pending guesses go to the host, players only receive their own latest guess, and guesses are archived out of live state when the round closes. A cap per player per round applies. Status: **to be fixed in the theme-guess module**.
