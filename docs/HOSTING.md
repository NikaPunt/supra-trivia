# Running a game

## The sample trivia
Every host finds a trivia called **Spooky OOs (sample)** in their list the first time they open the dashboard: a full night with two rounds and 29 questions, with a secret theme, a confidence set in each round, a final wager, and the special sections **Before & After**, **Three Actors and a Year**, **Vanna** (fill in the missing letters) and **Who Charted?**. It is a worked example of how everything fits together and a good first game to host.
- It is the host's own copy: edit it, rename it, or delete it. Deleting it is final; it is never added again.
- Everyone gets their own. Changing one host's copy never affects anyone else's.
- It comes from `public/starter.json`, the same file behind **Load sample trivia** in a new builder. To use your own as the starting trivia, replace that file. To turn the feature off, set `SEED_SAMPLE=false`.

## Starting from an old trivia
On the dashboard, **Duplicate** next to any of your trivias makes a copy called "... (copy)" and opens it in the builder. The copy has everything: rounds, questions, answers, sections, the secret theme, the guess limit and the time limits. It is yours alone, and editing it never changes the original or any game already played from it. An admin copying someone else's trivia gets their own copy, and that is logged.

## The order of play
Each question moves through four steps, always in this order, and the console only ever offers the next one:

1. **Open.** Players answer. The only big button is **Close answers**.
2. **Closed.** No more answers. Now you can **Reveal the answer**, or **Reopen answers** if you closed too early.
3. **Revealed.** The answer shows, scores update, and the only button is **Next question** (or **Next round**, or **Finish the game**).
4. Next question opens.

**Final Jeopardy** questions add one step at the start: players see only the category and place their wagers, you press **Show the question** when you are ready (the console says how many have wagered), and from then on it runs as above. The answer clock starts when the question is shown.

## Looking back
- **All questions** (a fourth tab on the console) lists every question with its answer, in order, with the one being played highlighted and the finished ones marked Done. When a player asks what an earlier answer was, it is there; answers still to come are folded away until you open them.
- **My answers** (on every player's phone, beside The game) lists that team's finished questions, newest first: what it said, whether it was right, the real answer when it was not, the points, and its total. It is a separate screen so it can never be mistaken for the live question, it shows only that team's own answers, and a question appears there once its answer is revealed.
- Answers on the console are listed with the ones waiting first and the newest on top; once you mark one it settles below. A theme guess you mark wrong is crossed off on the Theme guesses tab and on the team's phone (a guess marked right looks the same as one you have not marked, so nothing is given away).

## If the connection drops
The console and the projector keep their last screen when a refresh fails, buttons included, and retry every few seconds. After about four seconds (eight on the projector, so the room never sees a short blip) a small "Connection lost. Retrying…" note appears at the bottom, and it goes by itself when the connection is back. Nothing needs reloading.

## Fixing a slip
- **A wrong mark.** After the reveal the answers are still open to marking: change any of them with the buttons beside each answer. Nothing is banked until you press **Next question**.
- **Next question pressed by mistake.** Until a team answers the new question (or wagers on it, or you show a Final Jeopardy question), the console offers **Go back to the previous question**. It puts the last question back exactly as it was at its reveal: its answers and marks, the confidence values it used, and, if it was the step into round two, the theme going back to secret with its guesses. The session record is corrected too, and the step is logged. It works once, and never on a finished game.
- Once players have answered the new question there is no going back, so decide quickly. **Reopen answers** still covers closing a question too early.

You cannot reveal before closing, or move on before revealing. The server enforces it too, so a stale tab or a second host window cannot skip a step.

## The timer
Every question has a countdown, **3 minutes by default**, and answers close by themselves when it runs out, even if nobody has the console open.
- Set the default in the builder under **Time per question** (0 means no timer). A single question can have its own time under **More options**.
- While a question is open you can **Add 30 seconds**, or close it sooner.
- **Reopen answers** starts the full time again.
- Phones and the projector show the countdown next to the round name. It turns red and pulses in the last 10 seconds. Answers sent a moment after time is up are refused.
- If the server restarts mid-question, a question whose time ran out closes straight away when it comes back.

## Pausing
For an interruption, press **Pause** while a question is open.
- The clock freezes with the time that was left, and the time spent paused is not taken from the players.
- Answers are refused while paused. Phones show a **Paused** note, the projector shows a big **PAUSED** banner, and both show the frozen time. Answers already given are kept.
- **Resume** carries on from what was left. **Add 30 seconds** still works while paused. **Close answers** also ends the pause.
- It works on questions with no timer too, as a way to hold everyone for a moment.
- It survives a server restart, and a paused question is never closed by the timer.

## The console
Three tabs keep each job separate:
- **Question**: the step button, the question, the answer, and the answers coming in with the grading buttons. It says how many have answered, and "everyone is in" when all have.
- **Theme guesses**: the secret theme guesses to approve or reject. A red dot appears on this tab when a guess arrives that you have not looked at yet, so you can stay on the question without missing them. Opening the tab clears it.
- **Players and scores**: who is in, who has answered, removing someone, and the scoreboard.

**Open the projector view** lives in the room-code card at the top. **End session** is at the very bottom of the page, apart from the step buttons, so it can never be hit by accident.

## The projector
Open it in its own browser window or tab and put it on the TV.
- It **fits itself to the screen**: a long question shrinks just enough to stay on one screen. There is nothing to zoom.
- **Do not use browser zoom** (Ctrl and minus) on it. Browsers keep one zoom level per website, so zooming the projector would also shrink the host console. Use the **A−**, **Fit** and **A+** buttons in the footer instead (or the **+**, **-** and **0** keys). That size is remembered on that device for the projector only.
- Phones, the projector and the host console stay awake while the game is open, on browsers that allow it.
