# Limits

Everything the app limits, so nothing is a surprise. All of these are enforced by the server, so a modified phone or a forged request cannot get past them, and each has an automated test (`test/limits.test.ts` and `test/boundaries.test.ts`) that tries to break it.

## Points, wagers and confidence
| What | Limit |
|---|---|
| Points per question | 0 to 1000, in steps of 0.5 |
| Wager (Final wager (non-Jeopardy) and Final Jeopardy) | a whole number from 0 to the question's maximum (1 to 1000). Anything else is refused and changes nothing |
| Wager on a block with **Wager capped by team score** ticked | at most the team's banked points, rounded down, never below 0; the question's own maximum is not used |
| Final Jeopardy wager | kept by the server; locked the moment the question is shown; whatever a phone sends with its answer is ignored |
| Confidence values | each value in the pool can be used once per player (team). A skipped question spends nothing; a wrong answer still spends its stake. A pool has 2 to 10 values |
| A host's manual award | up to twice what the question is worth, and never less than 10 (so 10 on a 4-point question, 40 on a 20-point wager). More is refused with a message, which catches typing 100 for 1. Raise the question's points in the builder if you really want more |
| A theme bonus | up to twice the trivia's bonus, never less than 10 |
| Numbers in numeric questions and answers | between -1,000,000,000,000,000 and 1,000,000,000,000,000 |

## Guesses and time
| What | Limit |
|---|---|
| Guesses per question | 0 to 50; 0 means unlimited but is still capped at 20 so nothing can grow without bound |
| Theme guesses | 5 per player (team) |
| Time per question | 0 to 3600 seconds; 0 means no timer |
| Adding time while a question is open | 5 to 600 seconds at a time, and never more than 30 minutes from now |
| Answers after time is up | refused (a 1.5 second grace covers network delay) |

## Sizes
| What | Limit |
|---|---|
| Players (teams) in a session | 100 |
| Player or team name | 1 to 24 letters, numbers, spaces and `_ . ' -` |
| PIN | exactly 4 digits |
| An answer | 1 to 200 characters |
| A question | up to 1200 characters; up to 20 accepted answers of up to 200 characters; a multiple choice has 2 to 6 options |
| A trivia | title up to 120 characters; up to 30 rounds; up to 50 questions per round |
| Trivias per host | 100 (creating or duplicating beyond that is refused) |
| Active sessions per host | 5 |
| Any request body | 256 KB |
| Requests | 300 a minute per player or host (static files are not counted); joining and logging in are limited per address |

Hosts can still do anything the builder allows within these limits; the limits only stop mistakes and abuse.
