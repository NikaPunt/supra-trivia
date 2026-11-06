# Running a game

## The order of play
Each question moves through four steps, always in this order, and the console only ever offers the next one:

1. **Open.** Players answer. The only big button is **Close answers**.
2. **Closed.** No more answers. Now you can **Reveal the answer**, or **Reopen answers** if you closed too early.
3. **Revealed.** The answer shows, scores update, and the only button is **Next question** (or **Next round**, or **Finish the game**).
4. Next question opens.

You cannot reveal before closing, or move on before revealing. The server enforces it too, so a stale tab or a second host window cannot skip a step.

## The timer
Every question has a countdown, **3 minutes by default**, and answers close by themselves when it runs out, even if nobody has the console open.
- Set the default in the builder under **Time per question** (0 means no timer). A single question can have its own time under **More options**.
- While a question is open you can **Add 30 seconds**, or close it sooner.
- **Reopen answers** starts the full time again.
- Phones and the projector show the countdown next to the round name. It turns red and pulses in the last 10 seconds. Answers sent a moment after time is up are refused.
- If the server restarts mid-question, a question whose time ran out closes straight away when it comes back.

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
