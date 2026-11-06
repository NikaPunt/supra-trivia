# Bug log

**Open: none known.** Every bug found so far is fixed and has a test that fails if it comes back. Tests live in `test/`; run them with `npm test`.

| ID | Bug | Cause | Fix | Guarded by |
|---|---|---|---|---|
| BUG-001 | Theme guesses never cleared and slowed everything (from 0.1) | One flat list of guesses for the whole event | Guesses belong to the player, are capped at 5, go only to the host while pending, and are cleared when the theme goes public | `auth`, `game` |
| BUG-002 | Scores rose as answers landed, so players brute-forced guesses (from 0.1) | Results were sent as soon as an answer was marked | Players get no result, points or scoreboard until the host reveals; guess limit per question; scoreboards only at round end and game end | `auth`, `game` |
| BUG-003 | The stylesheet broke after one rule was deleted by a careless edit | A removed `.code` block took the following rules with it | Repaired; a test checks the braces balance | `game` |
| BUG-004 | Pages and static files were throttled when several players shared one IP | Rate limit keyed on IP and applied to static files | Static files exempt; per-cookie keys; join and login limited per IP | `auth` |
| BUG-005 | The screen flickered on every update and updates felt slow | Full re-render on each event; no check that the live stream worked | Re-render only when state changes; lists patched in place while typing; pings detect a dead stream and fall back to polling | `flow`, browser runs |
| BUG-006 | Projector sized wrongly on 4K and TVs, and zooming it shrank the host console | Browser zoom is shared per site | The projector fits itself with its own A-, Fit and A+ controls and never needs browser zoom | browser runs at 7 sizes in all 4 looks |
| BUG-007 | Console tabs overflowed on small phones | Fixed tab widths | Tabs share the width | browser runs |
| BUG-008 | The 0.1 converter (since removed) silently dropped clue content | It validated fine but copied only part of each question | Rebuilt to keep cast and year, puzzle boards, tracks and steps | `sample` |
| BUG-009 | Cleaning up legacy fields removed Final Jeopardy's category | The cleanup ignored question type | Made type-aware | `boundaries`, `sample` |
| BUG-010 | The host could press Next before answers were closed and revealed | Step buttons were not tied to the question's phase | Strict waterfall in the engine: open, close, reveal, next. The server refuses out-of-order steps | `flow`, `game` |
| BUG-011 | Teammates' phones could show different answers and overwrite each other | Per-device state | A team is one player: shared answer, guesses, history and theme guesses | `team` |
| BUG-012 | Huge numbers, unlimited trivias per host and typo-sized manual awards were accepted | Missing bounds | Number limit 1e15, 100 trivias per host, manual awards capped, 5 active sessions per host, 100 players per session | `limits`, `boundaries` |
| BUG-013 | A used confidence value could be spent again, and wagers could be out of range | Trusted the phone | The server refuses spent or invented values and any wager outside 0 to the maximum | `boundaries` |

## How bugs are handled
1. Reproduce it with a failing test.
2. Fix it.
3. Add a row above with the cause, the fix and the test.

Some tests were themselves wrong once (one passed for the wrong reason). After a fix, deliberately break the rule and confirm the test fails.
