# Scoring, guesses and the scoreboard

## Points
- Each question has a **Points** value you type in the builder (default 1, halves allowed). Confidence questions use their pool values; a wager uses the player's wager.
- Closest-number questions give the full points to the closest guess; ties share them. If you mark an answer right by hand it still counts in the comparison; one you mark wrong is out of it.
- A player's result for a question is their best scored answer, so several guesses never stack.

## Guess limits
- Trivia setting **Guesses each player gets per question**, default **3**. `0` means unlimited.
- A single question can override it (blank uses the trivia setting).
- Changing an answer uses a guess. 3 means the first answer plus two retries.
- "Unlimited" is capped at 20 per question so live state stays small.

## Hidden until it is over
Players never see whether an answer was right, what it earned, or any scoreboard until the host reveals the question. They only see their guesses left.
**Scoreboards appear only at the end of each round and at the end of the game** so no one can watch their score move mid-round.

## Limits
Confidence values, wagers and every other bound are enforced by the server, not the phone. See [LIMITS.md](LIMITS.md).

## Manual marking
For any answer the host clicks **Right**, **Half**, **Wrong**, or types any amount in steps of 0.5 and presses **Set**. For a confidence stake or a wager the buttons show what they award (e.g. Right +15, Wrong -15). This works while the question is open, closed or revealed and overrides automatic scoring. The host console also flags pending answers as "looks right" or "no match".

## Confidence sets and wagers
- **Confidence set:** all questions in a set share a list of values; a set is a run of confidence questions in a row with the same section (e.g. 8, 6, 4, 2; see [MODULES.md](MODULES.md#confidence-sets-and-sections)). Each player spends each value once. A value is spent once the question finishes, even if their answer was wrong. A question they never answered spends nothing.
- **Final wager (non-Jeopardy):** the team sends answer and wager together. The wager can be 0 up to the maximum. Right wins it, wrong loses it.
- **Final Jeopardy, no answer:** a team that wagers and then sends no answer loses its wager, as a wrong answer would, so staying silent is never the safe choice. Untick **No answer loses the wager** on the block to turn this off. The host console lists who lost a wager this way. A wager of 0 loses nothing.
- **Wager capped by team score** (a checkbox on each Final wager or Final Jeopardy block, off by default): a team can wager at most the whole points it has banked, and that block's own maximum is ignored (its box is greyed out). A team on zero can only wager 0. Other wager blocks are unaffected. The cap tells a team its own score, though not anyone else's, a little before the round-end scoreboard.

## The secret overall theme
- Set in the builder under **Overall theme**: the theme itself, a hint, and a formal explanation.
- Once the game starts, players can guess it **any time** (up to 5 guesses each). The host sees the guesses and approves or rejects each. Finding it is worth the same to every team: the bonus set in the builder (default 4), with nothing extra for being early. **Approve** gives that amount; the points box gives any other.
- The bonus is **hidden** and not added to scores until the theme goes public. That happens when **round two begins**, when **every player has an approved guess**, when the host presses **Reveal theme**, or when the game ends. Players see a "Don't forget the secret theme!" note with the hint until then; afterwards it shows the theme and its explanation, and the guess list is cleared.
- A player earns their best approved guess once, never a sum.
- **No guess is lost unmarked.** A guess that is the theme word for word (capitals and punctuation aside) is approved by itself when the theme goes public. While other guesses are still waiting for you, **Next round**, **Finish the game** and **Reveal theme** are refused with a message, because going public clears the list; mark them and press again. **End session** is never refused.

## Getting back in (PIN)
When joining, players can set an optional 4-digit PIN. Joining again with the same name and PIN returns the same player, scores and all. After 10 wrong PINs in a row, that name is locked for 5 minutes, not for good, so a stranger cannot shut a team out. The host sees the lock under **Players and scores** and can press **Let back in** to lift it at once.

The host can also **close the room to new players** there once everyone has arrived. Teams already in can still get back in with their name and PIN.
