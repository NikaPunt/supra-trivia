# Roles

| Role | How they get in | What they can do |
|------|-----------------|------------------|
| **Player** | Room code + nickname, no account | Answer questions in the one session they joined |
| **Host** | Google login, email listed under `hosts` in `config/hosts.json` | Build trivias, run live sessions, remove players. Only sees their own |
| **Admin** (project owner) | Google login, email listed under `admins` | Everything a host can do, on **everyone's** trivias and sessions |

## Admin powers
- `/admin.html` lists all sessions, trivias and hosts, plus the audit log.
- **Control** any session: reveal, move on, reopen, remove players, review answers, or **End** it if something is broken.
- Edit or delete any trivia.
- Every admin action on someone else's resource, and every "end session", is written to the `audit` table and shown in the admin page.
- Admin-controlled sessions show a banner to the admin so it's clear they are acting on someone else's session.

## Managing who can log in
`config/hosts.json` (gitignored; copy `config/hosts.example.json`):
```json
{ "admins": ["you@gmail.com"], "hosts": ["friend@gmail.com"] }
```
The file is re-read when it changes. If an edit makes it invalid JSON, the last good list stays in force, so a typo cannot lock you out or let anyone in.
Removing someone takes effect on their next request: roles are looked up from the file each time, never trusted from the login cookie.
