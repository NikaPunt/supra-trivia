import { $, api, describeAnswer, enterIfChanged, h, keepAwake, live, mount, questionBlock, revealBlock, art, scoreSign, stable, syncClock, themeNote, timerOf } from "./common.js";

// Typed text survives re-renders caused by live updates.
const drafts = { answer: "", theme: "", stake: "", key: "", seen: "", wager: "", seenWager: "" };

function board(state) {
  if (!state.leaderboard) return null;
  const ended = state.phase === "ended";
  return scoreSign(ended ? "Final scores" : "Scores after this round", state.leaderboard, { ended,
    extra: state.myRank && state.myRank > 10 ? h("p", { class: "muted" }, `You are #${state.myRank}`) : null });
}

/** The team's theme guesses, oldest first: who sent each and how many are left after it. */
function themeHistory(t) {
  const total = t.myGuesses.length + t.guessesLeft;
  const showWho = t.myGuesses.some((g) => !g.you); // only mention who when more than one phone is involved
  return h("div", { class: "theme-hist" },
    h("div", { class: "eyebrow" }, `Theme guesses · ${t.guessesLeft} of ${total} left`),
    t.myGuesses.map((g, i) => h("div", { class: "g" },
      h("span", {}, `${i + 1}. ${g.text}`),
      h("span", { class: "muted" }, [showWho ? (g.you ? "you" : "a teammate") : "", `${total - (i + 1)} left`].filter(Boolean).join(" · ")))));
}

/** The theme as a note card. While it is secret it also holds the box for guessing it. */
function themeCard(state) {
  const t = state.theme;
  if (!t) return null;
  if (t.revealed) return themeNote(t, t.myBonus ? h("p", {}, `You earned +${t.myBonus} for finding it.`) : null);
  if (state.phase === "lobby" || state.phase === "ended") return themeNote(t);
  const field = h("input", { placeholder: "What connects it all?", maxlength: 200, value: drafts.theme, disabled: t.guessesLeft === 0, "aria-label": "Guess the secret theme" });
  field.addEventListener("input", () => { drafts.theme = field.value; });
  const err = h("p", { class: "err" });
  const send = async () => {
    if (!field.value.trim()) return;
    try { await api("/api/play/theme", { method: "POST", body: { guess: field.value } }); drafts.theme = ""; await refresh(); }
    catch (e) { err.textContent = e.message; }
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  return themeNote(t,
    h("div", { class: "row" }, h("div", { class: "grow" }, field), h("button", { disabled: t.guessesLeft === 0, onclick: send }, "Guess")),
    themeHistory(t),
    err);
}

function stakeInput(st) {
  if (!st) return null;
  const el = st.options
    ? h("select", {}, h("option", { value: "" }, "choose…"), st.options.map((o) => h("option", { value: o }, String(o))))
    : h("input", { type: "number", min: st.min, max: st.max, step: 1, placeholder: `${st.min}–${st.max}` });
  el.value = drafts.stake;
  el.addEventListener("input", () => { drafts.stake = el.value; });
  return { el, node: h("div", { class: "stake" }, h("label", {}, st.label), el) };
}

/** Every guess the team has made on this question, so teammates can see what has been tried and who sent it. */
function guessHistory(state) {
  const log = state.guessLog;
  if (!log.length) return null;
  const showWho = log.some((e) => !e.you); // only mention who when more than one phone is involved
  return h("div", { class: "guesses" },
    h("div", { class: "eyebrow" }, state.guessesLeft === null ? "Guesses so far" : `Guesses so far · ${state.guessesLeft} left`),
    log.map((e) => h("div", { class: `g${e.current ? " cur" : ""}` },
      h("span", {}, describeAnswer(state.item, e.value)),
      h("span", { class: "muted" }, [e.current ? "locked in" : "", showWho ? (e.you ? "you" : "a teammate") : ""].filter(Boolean).join(" · ")))));
}

/** Final Jeopardy, step one: the category is showing and each team locks in a wager, until the host shows the question. */
function wagerInput(state) {
  const max = state.item.wagerMax;
  const mine = state.myWager;
  if (drafts.seenWager !== String(mine)) { drafts.seenWager = String(mine); drafts.wager = ""; } // a teammate's wager replaces a half-typed one
  const err = h("p", { class: "err" });
  const field = h("input", { type: "number", inputmode: "numeric", min: 0, max, step: 1, placeholder: `0 to ${max}`, "aria-label": "Your wager", disabled: state.paused, autocomplete: "off",
    value: drafts.wager || (mine ?? "") });
  field.addEventListener("input", () => { drafts.wager = field.value; });
  const send = async () => {
    const n = Number(field.value);
    if (field.value === "" || !Number.isInteger(n) || n < 0 || n > max) { err.textContent = `A wager is a whole number from 0 to ${max}.`; return; }
    try { await api("/api/play/wager", { method: "POST", body: { value: n } }); err.textContent = ""; drafts.wager = ""; await refresh(); }
    catch (e) { err.textContent = e.message; }
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  return h("div", {},
    h("p", { class: "muted" }, `Wager up to ${max} points. A right answer wins it and a wrong one loses it.`),
    field,
    h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "primary", disabled: state.paused, onclick: send }, mine === null ? "Lock in wager" : "Change wager")),
    mine !== null ? h("p", {}, `Your wager: ${mine} point${mine === 1 ? "" : "s"}. You can change it until the question is shown.`) : null,
    err);
}

function inputFor(state) {
  const { item } = state;
  if (item.stage === "wager") return wagerInput(state);
  const err = h("p", { class: "err" });
  const st = stakeInput(state.stake);
  const send = async (value) => {
    if (st) {
      if (st.el.value === "") { err.textContent = `Choose: ${state.stake.label}`; return; }
      value[state.stake.key] = Number(st.el.value);
    }
    try { await api("/api/play/answer", { method: "POST", body: { value } }); err.textContent = ""; await refresh(); }
    catch (e) { err.textContent = e.message; }
  };
  const open = state.phase === "open" && state.guessesLeft !== 0 && !state.paused;
  const mine = state.myAnswers;
  // If a teammate changed the team's answer, show it instead of whatever was half-typed here.
  const serverVal = mine.length ? JSON.stringify(mine[0].value) : "";
  if (drafts.seen !== serverVal) { drafts.seen = serverVal; drafts.answer = ""; }
  if (item.input.kind === "choice") {
    const cur = mine[0]?.value[item.input.key];
    return h("div", {}, st?.node, h("div", { class: "choices" }, item.public.options.map((o, i) =>
      h("button", { class: i === cur ? "picked" : "", disabled: !open, onclick: () => send({ [item.input.key]: i }) }, o))), err);
  }
  const wagerNote = item.stage === "clue" ? h("p", { class: "muted" }, state.myWager === null ? "You did not wager, so this answer is worth nothing either way." : `Your wager: ${state.myWager} point${state.myWager === 1 ? "" : "s"}, locked in.`) : null;
  const field = h("input", { type: item.input.kind === "number" ? "number" : "text", step: "any", maxlength: 200, disabled: !open, autocomplete: "off", "aria-label": "Your answer",
    value: drafts.answer || (mine[0]?.value[item.input.key] ?? "") });
  field.addEventListener("input", () => { drafts.answer = field.value; });
  const submit = () => {
    const raw = field.value.trim();
    if (item.input.kind === "text" && raw && !/[\p{L}\p{N}]/u.test(raw)) { err.textContent = "Your answer must have at least one letter or number."; return; }
    if (raw) send({ [item.input.key]: item.input.kind === "number" ? Number(raw) : raw });
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return h("div", {}, wagerNote, st?.node, field, h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "primary", disabled: !open, onclick: submit }, mine.length ? "Change answer" : "Lock in")), err);
}

const foot = (state) => h("div", { class: "ft" }, h("span", {}, state.me), h("span", {}, `Room ${state.code}`));

function render(state) {
  const key = `${state.number}:${state.phase === "lobby"}`;
  if (drafts.key !== key) { drafts.answer = ""; drafts.stake = ""; drafts.seen = ""; drafts.wager = ""; drafts.seenWager = ""; drafts.key = key; }
  if (state.phase === "lobby") {
    return mount($("#app"), art("table", { size: "wide" }), h("h1", {}, state.title), h("p", { class: "muted" }, `Waiting for the host to begin. ${state.players} at the table.`), themeCard(state), foot(state));
  }
  if (state.phase === "ended") {
    return mount($("#app"), art("tamada", { size: "wide" }),
      h("div", { class: "toast" }, h("span", { class: "geo" }, "გაუმარჯოს!"), h("span", { class: "plain" }, "That's a wrap!")),
      h("p", { class: "muted geo" }, "Gaumarjos! That's a wrap."),
      themeCard(state), board(state), foot(state));
  }
  const it = state.item;
  const mine = state.myAnswers;
  mount($("#app"),
    questionBlock(it, timerOf(state)),
    state.paused ? h("div", { class: "note paused-note" }, art("bear", { size: "thumb" }), h("div", {}, h("b", {}, "Paused"), h("p", {}, "The host will carry on in a moment. Your answer is safe."))) : null,
    state.phase === "revealed"
      ? h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Your answer"),
          mine.length
            ? h("div", { class: "yours" }, h("strong", {}, describeAnswer(it, mine[0].value)),
                h("span", {}, mine[0].points > 0 ? `+${mine[0].points} points` : mine[0].points < 0 ? `${mine[0].points} points` : "No points"))
            : h("p", { class: "muted" }, state.forfeit ? `You didn't answer this one, so your wager of ${state.forfeit} is lost.` : "You didn't answer this one."),
          guessHistory(state))
      : h("div", { class: "card" },
          state.phase === "closed" ? h("p", { class: "muted" }, "Answers are closed.") : null,
          inputFor(state),
          it.stage === "wager" ? null : (guessHistory(state) ?? (state.guessesLeft !== null ? h("p", { class: "muted" }, `Guesses left: ${state.guessesLeft}`) : null))),
    revealBlock(it),
    themeCard(state), board(state), foot(state));
}

const anim = {};
let lastRaw = "";
/**
 * Everything on screen except the two lists teammates add to (the question's guesses and the theme guesses).
 * If only those changed while someone is typing, the lists are updated in place and the box being typed in is never rebuilt.
 */
const shellOf = (s) => JSON.stringify({
  ...s,
  guessLog: s.guessLog.length > 0,
  guessesLeft: s.guessesLeft === 0,
  theme: s.theme && { ...s.theme, myGuesses: s.theme.myGuesses.length > 0, guessesLeft: s.theme.guessesLeft === 0 },
});
let lastShell = "";
function patch(state) {
  if (state.theme && !state.theme.revealed) $("#app .theme-hist")?.replaceWith(themeHistory(state.theme));
  const old = $("#app .guesses");
  const next = guessHistory(state);
  if (old && next) old.replaceWith(next);
}

let lastSig = "";
async function refresh() {
  try {
    const state = await api("/api/play/state");
    syncClock(state.timer);
    // Nothing changed since the last draw: leave the page exactly as it is.
    const raw = stable(state);
    if (raw === lastRaw) return;
    const typing = document.activeElement?.closest?.("#app") && /INPUT|SELECT/.test(document.activeElement.tagName);
    if (typing && shellOf(state) === lastShell) { patch(state); lastRaw = raw; return; }
    // Don't yank the keyboard away mid-typing when nothing that matters changed.
    const sig = JSON.stringify([state.phase, state.number, state.guessesLeft, state.theme?.revealed, state.theme?.guessesLeft, state.myAnswers.map((a) => a.value), state.myWager, state.item?.stage, state.guessLog.length, state.leaderboard?.length, state.stake?.options]);
    if (sig === lastSig && document.activeElement?.closest("#app") && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    lastSig = sig;
    lastRaw = raw;
    lastShell = shellOf(state);
    // If a full redraw is unavoidable, put the cursor back where it was.
    const f = typing ? document.activeElement : null;
    const keep = f ? { label: f.getAttribute("aria-label"), at: f.selectionStart } : null;
    render(state);
    if (keep?.label) {
      const el = [...document.querySelectorAll("#app input")].find((i) => i.getAttribute("aria-label") === keep.label);
      if (el && !el.disabled) { el.focus(); try { el.setSelectionRange(keep.at, keep.at); } catch { /* not a text box */ } }
    }
    enterIfChanged(`${state.number}:${state.phase}`, anim);
  }
  catch (e) { if (e.status === 401) location.href = "/"; }
}
refresh();
live("/api/play/events", refresh);
keepAwake();
