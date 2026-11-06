# Playing as a team

A team is one player that several phones share. Everyone joins with the **same name and the same PIN**, and from then on all of those phones are the same player: one answer, one guess allowance, one score. The first phone to join should set the PIN; without one, a second phone cannot join under that name.

## What the phones share
- **The locked-in answer.** Whoever locks in last sets the team's answer, and every phone shows it straight away.
- **The guess allowance.** Three guesses (or whatever the host chose) are shared by the whole team, not three each.
- **The score**, the theme guesses (and their limit of five) and the scoreboard position. A team is treated as one person: there are no per-person scores.

## What each phone sees
Under the answer box is **Guesses so far**: everything the team has tried on this question, oldest first, with the current answer in bold and marked *locked in*. Once more than one phone is involved it also says who sent each guess, as **you** or **a teammate**, so nobody repeats a guess that has already failed. The history belongs to the question and starts empty on the next one. After the reveal it stays on screen for the question you just played.

If a teammate changes the answer while you are typing, your half-typed text is replaced by the team's real answer instead of silently overwriting it later.

## The secret theme
Theme guesses belong to the team too. The note card lists every theme guess the team has made, oldest first and numbered, with who sent it and how many guesses are left after it:

```
Theme guesses · 2 of 5 left
1. moon      you · 4 left
2. sun       a teammate · 3 left
3. stars     you · 2 left
```

- **One allowance.** Five theme guesses for the whole team. Every guess from any phone uses one, and every phone shows the same count and locks at the same moment.
- **Nobody learns if a guess was right** until the theme goes public, same as for a single player.
- **One bonus per team.** The host sees every guess under the team's name and approves whichever ones are right. The team earns the single best bonus once, however many of its phones found it.
- **Typing is never interrupted.** If a teammate guesses while you are typing in the theme box, the list above it updates in place; your box keeps its text and your cursor, so the keyboard stays open.

## How it stays in step
Phones are told about changes the moment they happen (the host moving on, a teammate's guess, the reveal) over the same live connection, so teammates see the same thing at the same time. If the live connection is held back by a proxy or a weak signal, a phone falls back to checking every few seconds. Tested with two separate browsers: a host action reached both within a millisecond of each other, and a guess on one phone showed up on the other in about a tenth of a second.

## Limits
- A phone in the background (another app, a locked screen) may update a moment late; it catches up the instant it is opened again.
- If two teammates lock in at the very same instant, the later one wins on every phone and both guesses appear in the history. Both used a guess.
- The host sees one team, not one row per phone, and scores are for the team. There is no per-person score within a team.
- The "you" and "a teammate" labels are per phone, using a random id kept in that phone's browser. It identifies nobody and is never shown to anyone.
