# Roles

| Role | How they get in | What they can do |
|------|-----------------|------------------|
| **Player** | Room code + nickname, no account | Answer questions in the one session they joined |
| **Host** | Google login, email listed under `hosts` in `config/hosts.json` | Build trivias, run live sessions, remove players. Only sees their own |
| **Admin** (project owner) | Google login, email listed under `admins` | Everything a host can do, on **everyone's** trivias and sessions |

## Admin powers
- `/admin.html` shows the server's state (sessions, database size, uptime, anything that needs a look), all sessions live and finished, all trivias, every host with their last sign-in, and the audit log with a filter and a download.
- Open the **Record** of any session: what every team answered. See [LOGGING.md](LOGGING.md).
- **Sign out everywhere** for any host: ends all their sign-ins at once (a lost phone, a shared computer). They can sign in again; to keep them out, take them off the hosts file.
- **Control** any session: reveal, move on, reopen, remove players, review answers, or **End** it if something is broken.
- Edit or delete any trivia.
- Everything hosts and admins change is written to the audit log, with the time and the address it came from; an admin acting on someone else's trivia or session is flagged. The full list is in [LOGGING.md](LOGGING.md).
- Admin-controlled sessions show a banner to the admin so it's clear they are acting on someone else's session.

## Managing who can log in
`config/hosts.json` (gitignored; copy `config/hosts.example.json`):
```json
{ "admins": ["you@gmail.com"], "hosts": ["friend@gmail.com"] }
```
Gmail addresses are matched ignoring dots, `+tags` and `googlemail.com` (Google treats them as one inbox); other domains match exactly.
The file is re-read when it changes. If an edit makes it invalid JSON, the last good list stays in force, so a typo cannot lock you out or let anyone in.
A host stays signed in for 30 days on that browser, and the home page then shows a **Go to my trivias** button instead of asking them to log in again. Logging out ends it on that browser; **Log out everywhere**, at the bottom of *My trivias*, ends it on all of them.

Removing someone takes effect on their next request: roles are looked up from the file each time, never trusted from the login cookie.
