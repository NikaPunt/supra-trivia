import { $, api, describeAnswer, enterIfChanged, h, live, mount, questionBlock, revealBlock, scene, themeNote } from "./common.js";

// Typed text survives re-renders caused by live updates.
const drafts = { answer: "", theme: "", stake: "", key: "", seen: "" };

function board(state) {
  if (!state.leaderboard) return null;
  return h("div", { class: "card" }, h("h2", {}, state.phase === "ended" ? "Final scores" : "Scores after this round"),
    state.leaderboard.map((r, i) => h("div", { class: `rank ${r.me ? "me" : ""}` }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points))),
    state.myRank && state.myRank > 10 ? h("p", { class: "muted" }, `You are #${state.myRank}`) : null);
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
    h("p", { class: "muted" }, t.myGuesses.length ? `${t.myGuesses.join(", ")} · ${t.guessesLeft} left` : `${t.guessesLeft} guesses`),
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

function inputFor(state) {
  const { item } = state;
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
  const open = state.phase === "open" && state.guessesLeft !== 0;
  const mine = state.myAnswers;
  // If a teammate changed the team's answer, show it instead of whatever was half-typed here.
  const serverVal = mine.length ? JSON.stringify(mine[0].value) : "";
  if (drafts.seen !== serverVal) { drafts.seen = serverVal; drafts.answer = ""; }
  if (item.input.kind === "choice") {
    const cur = mine[0]?.value[item.input.key];
    return h("div", {}, st?.node, h("div", { class: "choices" }, item.public.options.map((o, i) =>
      h("button", { class: i === cur ? "picked" : "", disabled: !open, onclick: () => send({ [item.input.key]: i }) }, o))), err);
  }
  const field = h("input", { type: item.input.kind === "number" ? "number" : "text", step: "any", maxlength: 200, disabled: !open, autocomplete: "off", "aria-label": "Your answer",
    value: drafts.answer || (mine[0]?.value[item.input.key] ?? "") });
  field.addEventListener("input", () => { drafts.answer = field.value; });
  const submit = () => {
    const raw = field.value.trim();
    if (raw) send({ [item.input.key]: item.input.kind === "number" ? Number(raw) : raw });
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return h("div", {}, st?.node, field, h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "primary", disabled: !open, onclick: submit }, mine.length ? "Change answer" : "Lock in")), err);
}

const foot = (state) => h("div", { class: "ft" }, h("span", {}, state.me), h("span", {}, `Room ${state.code}`));

function render(state) {
  const key = `${state.number}:${state.phase === "lobby"}`;
  if (drafts.key !== key) { drafts.answer = ""; drafts.stake = ""; drafts.seen = ""; drafts.key = key; }
  if (state.phase === "lobby") {
    return mount($("#app"), scene(), h("h1", {}, state.title), h("p", { class: "muted" }, `Waiting for the host to begin. ${state.players} at the table.`), themeCard(state), foot(state));
  }
  if (state.phase === "ended") {
    return mount($("#app"), scene(),
      h("div", { class: "toast" }, h("span", { class: "geo" }, "გაუმარჯოს!"), h("span", { class: "plain" }, "That's a wrap!")),
      h("p", { class: "muted geo" }, "Gaumarjos! That's a wrap."),
      themeCard(state), board(state), foot(state));
  }
  const it = state.item;
  const mine = state.myAnswers;
  mount($("#app"),
    questionBlock(it),
    state.phase === "revealed"
      ? h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Your answer"),
          mine.length
            ? h("div", { class: "yours" }, h("strong", {}, describeAnswer(it, mine[0].value)),
                h("span", {}, mine[0].points > 0 ? `+${mine[0].points} points` : mine[0].points < 0 ? `${mine[0].points} points` : "No points"))
            : h("p", { class: "muted" }, "You didn't answer this one."),
          guessHistory(state))
      : h("div", { class: "card" },
          state.phase === "closed" ? h("p", { class: "muted" }, "Answers are closed.") : null,
          inputFor(state),
          guessHistory(state) ?? (state.guessesLeft !== null ? h("p", { class: "muted" }, `Guesses left: ${state.guessesLeft}`) : null)),
    revealBlock(it),
    themeCard(state), board(state), foot(state));
}

const anim = {};
let lastRaw = "";
let lastSig = "";
async function refresh() {
  try {
    const state = await api("/api/play/state");
    // Nothing changed since the last draw: leave the page exactly as it is.
    const raw = JSON.stringify(state);
    if (raw === lastRaw) return;
    // Don't yank the keyboard away mid-typing when nothing that matters changed.
    const sig = JSON.stringify([state.phase, state.number, state.guessesLeft, state.theme?.revealed, state.theme?.guessesLeft, state.myAnswers.map((a) => a.value), state.guessLog.length, state.leaderboard?.length, state.stake?.options]);
    if (sig === lastSig && document.activeElement?.closest("#app") && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    lastSig = sig;
    lastRaw = raw;
    render(state);
    enterIfChanged(`${state.number}:${state.phase}`, anim);
  }
  catch (e) { if (e.status === 401) location.href = "/"; }
}
refresh();
live("/api/play/events", refresh);
