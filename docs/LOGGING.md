# Logs, the audit log and session records

The app keeps three different things. They answer different questions and live in different places.

| | Answers | Lives in | Kept |
|---|---|---|---|
| **Session record** | What did every team answer on every question, and what did it earn? | the database (`game_records`) | as long as the session |
| **Audit log** | Who changed what, when, and from where? | the database (`audit`) | forever, unless `AUDIT_RETENTION_DAYS` is set |
| **Server log** | What is the server doing; what went wrong? | the container's output | 50 MB, then the oldest is dropped |

The first two are in the database, so the nightly backup carries them. The server log is for running the server and is not a record of anything.

## Session record
When the host moves on from a question, the app files what happened on it: the question and its answer, each team's final answer, whether it was right, the points, whether the host set those points by hand, every guess in order (including ones later replaced), wagers, and wagers lost by not answering. The secret theme's guesses are filed when the theme goes public.

- **Where to see it:** *Past sessions* on a host's dashboard, or *Record* beside any session on the admin page. A running session's record fills in question by question.
- **Download** as CSV (one row per answer, for a spreadsheet) or JSON (everything).
- **Who can see it:** the session's host and admins. Never players, never another host. An admin opening someone else's record is itself logged.
- **Finished sessions are never deleted** unless you set `GAME_RETENTION_DAYS`. If you do, a session's record goes with it, and the audit log keeps a line saying it existed and when it was deleted.
- Sessions played before this existed have their final scores and the points per question, but not the answers: those were not being kept.

Team names and answers are whatever players typed. The CSV download defuses anything a spreadsheet would run as a formula.

## Audit log
Every change made by a signed-in host or admin, with the time, the person, and the address it came from:

| Area | Recorded |
|---|---|
| Signing in | each sign-in, sign-out and "log out everywhere"; a sign-in **refused** because the Google account is not a host |
| Trivias | created, saved, copied, deleted |
| Sessions | opened, started, ended; a player removed; the room closed or reopened; a PIN lock lifted; the theme revealed |
| Admins | anything at all an admin does in someone else's trivia or session (flagged *as admin*); signing a host out; downloading this log; opening someone else's session record |
| The system | an old session deleted by the retention setting |

Not here on purpose: marking answers right or wrong (dozens per question; each mark is in the session record instead), and anything players do (the session record).

The admin page shows it newest first, with a filter and a CSV download of the whole log. Entries cannot be edited or deleted from the app.

## Server log
One line of JSON per event, written to the container's output: `docker compose logs trivia`.

- **What is written at the default level (`info`):** every request that changes something, every request that was refused, every fault, every audit entry (so the two can be matched by `reqId`), joins and refused joins, start-up and shutdown.
- **What is not:** page loads, polls and health checks. Set `LOG_LEVEL=debug` to see those too; it is noisy on a game night.
- **Levels:** `error` is a fault in the app and has a stack trace. `warn` is someone being turned away: rate limited, wrong origin, failed sign-in, refused join. `info` is normal business.
- **Each request line has:** `method`, `url`, `status`, `ms`, `ip` (the visitor's real address; see `TRUST_PROXY` in [DEPLOY.md](DEPLOY.md)) and `who` (`host:<email>` or `player:<team>@<room code>`).
- **Never written:** cookies, sign-in codes (the query string is dropped on `/auth/` addresses), PINs, answers, or the contents of a trivia.

Useful searches:
```bash
docker compose logs trivia | grep '"level":50'            # faults
docker compose logs trivia | grep '"level":40'            # people turned away
docker compose logs trivia | grep '"audit"'               # what hosts and admins did
docker compose logs trivia | grep 'ABCDE'                 # everything about one room code
```
The compose files cap the log at five files of 10 MB. To keep logs longer, send them somewhere built for it (Loki, a syslog server); the lines are standard pino JSON.

## Settings
| Setting | Default | Meaning |
|---|---|---|
| `LOG_LEVEL` | `info` | `debug` adds reads and polls; `warn` keeps only refusals and faults |
| `AUDIT_RETENTION_DAYS` | `0` | audit entries older than this are deleted; 0 keeps them forever |
| `GAME_RETENTION_DAYS` | `0` | finished sessions (and their records) older than this are deleted; 0 keeps them forever |

## Privacy
The audit log and the server log hold host email addresses and visitors' IP addresses, and session records hold team names. If people outside your circle of friends use the site, say so somewhere they will see it, and set the two retention settings to a period you can justify.
