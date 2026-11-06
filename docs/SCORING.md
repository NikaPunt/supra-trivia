# Scoring and guesses

## Points
- Each question has a **Points** value the host types in the builder (default 1; theme guess bonus default 2). Halves are allowed.
- Closest-number questions give the full points to the closest guess; ties share them.
- A player's score for a question is the best answer they have, so several approved guesses never stack.

## Guess limits
- Trivia setting **Guesses each player gets per question**, default **3**. `0` means unlimited.
- A single question can override it ("Max guesses for this question"; blank uses the trivia setting).
- Changing an answer on a single-answer question uses a guess; multi-guess questions (theme guess) keep every guess.
- The setting is a number of guesses in total, so 3 means the first guess plus two retries.
- "Unlimited" is capped at 20 guesses per player per question so live state stays small.

## Hidden until reveal
Players never see whether an answer was right, what it earned, or any scoreboard until the host reveals the question (BUG-002). They only see how many guesses they have left.

## Manual marking
For any answer the host can click **Right** (full points), **Half**, **Wrong**, or type any amount in steps of 0.5 and press **Set**. This works while the question is open, closed or revealed, and overrides automatic scoring.
