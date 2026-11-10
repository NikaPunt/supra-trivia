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
| A builder draft (unsaved work backed up to the server) | up to 1 million characters, more than a trivia can be saved at, so a draft is never refused for being big. If one cannot be stored, the builder says so on the page. One per host per trivia |
| Players (teams) in a session | 100 at the table; removed players do not count. 400 joins in all, removed or not. The host can close the room to new players |
| Player or team name | 1 to 24 letters, numbers, spaces and `_ . ' -` |
| PIN | exactly 4 digits. 10 wrong in a row lock the name for 5 minutes; the host can lift the lock |
| Live-update connections | 20 per team or host per session, 600 per session. Past that a screen checks every 3 seconds instead |
| An answer | 1 to 200 characters, with at least one letter or number (blank or punctuation-only answers are refused, and so are blank or punctuation-only accepted answers in the builder) |
| A question | up to 1200 characters; up to 20 accepted answers of up to 200 characters; a multiple choice has 2 to 6 options |
| A trivia | title up to 120 characters; up to 30 rounds; up to 50 questions per round |
| Trivias per host | 100 (creating or duplicating beyond that is refused) |
| Active sessions per host | 5 |
| Any request body | 256 KB |
| Requests | 300 a minute per joined player or signed-in host (static files are not counted); everyone else, and logging in, is counted per address. Joining is counted per address by what goes wrong, not by how many arrive: any number of successful joins (150 attempts a minute at most), but only 30 refused ones a minute (a wrong room code, a wrong PIN, a taken name; a typo in a name does not count), so a whole room can arrive over one shared address while guessing room codes or PINs is cut off. A made-up cookie or `X-Forwarded-For` does not change who you are counted as |

Hosts can still do anything the builder allows within these limits; the limits only stop mistakes and abuse.
