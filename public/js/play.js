import { $, api, describeAnswer, h, live, mount, questionBlock, revealBlock, scene } from "./common.js";

// Typed text survives re-renders caused by live updates.
const drafts = { answer: "", theme: "", stake: "", key: "" };

function board(state) {
  if (!state.leaderboard) return null;
  return h("div", { class: "card" }, h("h2", {}, state.phase === "ended" ? "Final scores" : "Scores after this round"),
    state.leaderboard.map((r, i) => h("div", { class: `rank ${r.me ? "me" : ""}` }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points))),
    state.myRank && state.myRank > 10 ? h("p", { class: "muted" }, `You are #${state.myRank}`) : null);
}

function themeCard(state) {
  const t = state.theme;
  if (!t) return null;
  if (t.revealed) {
    return h("div", { class: "card theme-card" }, h("h2", {}, "The secret theme was…"), h("p", {}, h("strong", {}, t.secret)), t.formal ? h("p", {}, t.formal) : null,
      t.myBonus ? h("p", {}, `You earned +${t.myBonus} for guessing it.`) : null);
  }
  if (state.phase === "lobby" || state.phase === "ended") {
    return h("div", { class: "card theme-card" }, h("h2", {}, "There's a secret theme"), h("p", { class: "muted" }, `It links the whole game. Once we start, guess it any time for bonus points; earlier guesses are worth more.${t.hint ? ` Hint: ${t.hint}` : ""}`));
  }
  const field = h("input", { placeholder: "What connects it all?", maxlength: 200, value: drafts.theme, disabled: t.guessesLeft === 0 });
  field.addEventListener("input", () => { drafts.theme = field.value; });
  const err = h("p", { class: "err" });
  const send = async () => {
    if (!field.value.trim()) return;
    try { await api("/api/play/theme", { method: "POST", body: { guess: field.value } }); drafts.theme = ""; await refresh(); }
    catch (e) { err.textContent = e.message; }
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
  return h("div", { class: "card theme-card" }, h("h2", {}, "Secret theme"), t.hint ? h("p", { class: "muted" }, `Hint: ${t.hint}`) : null,
    h("div", { class: "row" }, h("div", { class: "grow" }, field), h("button", { disabled: t.guessesLeft === 0, onclick: send }, "Guess")),
    h("p", { class: "muted" }, `${t.guessesLeft} theme guesses left. You will learn if you got it when the host reveals the theme.`),
    t.myGuesses.length ? h("div", { class: "muted" }, "Your guesses: " + t.myGuesses.join(", ")) : null, err);
}

function stakeInput(st) {
  if (!st) return null;
  const el = st.options
    ? h("select", {}, h("option", { value: "" }, "choose…"), st.options.map((o) => h("option", { value: o }, String(o))))
    : h("input", { type: "number", min: st.min, max: st.max, step: 1, placeholder: `${st.min}–${st.max}` });
  el.value = drafts.stake;
  el.addEventListener("input", () => { drafts.stake = el.value; });
  return { el, node: h("div", {}, h("label", {}, st.label), el) };
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
  if (item.input.kind === "choice") {
    const cur = mine[0]?.value[item.input.key];
    return h("div", {}, st?.node, h("div", { class: "choices" }, item.public.options.map((o, i) =>
      h("button", { class: i === cur ? "picked" : "", disabled: !open, onclick: () => send({ [item.input.key]: i }) }, o))), err);
  }
  const field = h("input", { type: item.input.kind === "number" ? "number" : "text", step: "any", maxlength: 200, disabled: !open, autocomplete: "off",
    value: drafts.answer || (mine[0]?.value[item.input.key] ?? "") });
  field.addEventListener("input", () => { drafts.answer = field.value; });
  const submit = () => {
    const raw = field.value.trim();
    if (raw) send({ [item.input.key]: item.input.kind === "number" ? Number(raw) : raw });
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return h("div", {}, st?.node, field, h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "primary", disabled: !open, onclick: submit }, mine.length ? "Change answer" : "Lock in")), err);
}

function render(state) {
  const key = `${state.number}:${state.phase === "lobby"}`;
  if (drafts.key !== key) { drafts.answer = ""; drafts.stake = ""; drafts.key = key; }
  const head = h("div", { class: "row" }, h("strong", {}, state.me), h("span", { class: "grow" }), h("span", { class: "eyebrow" }, `Room ${state.code}`));
  if (state.phase === "lobby") return mount($("#app"), head, scene(), h("h1", {}, state.title), h("p", { class: "muted" }, `Waiting for the host to begin. ${state.players} at the table.`), themeCard(state));
  if (state.phase === "ended") return mount($("#app"), head, scene(), h("div", { class: "toast" }, "გაუმარჯოს!"), h("p", { class: "muted" }, "Gaumarjos! That's a wrap."), themeCard(state), board(state));
  const it = state.item;
  const mine = state.myAnswers;
  mount($("#app"), head,
    questionBlock(it, `${it.round} · ${state.number}/${state.total}`),
    state.phase === "revealed"
      ? h("div", { class: "card" }, h("div", { class: "eyebrow" }, "Your answer"),
          mine.length
            ? h("div", { class: "yours" }, h("strong", {}, describeAnswer(it, mine[0].value)),
                h("span", {}, mine[0].points > 0 ? `+${mine[0].points} points` : mine[0].points < 0 ? `${mine[0].points} points` : "No points"))
            : h("p", { class: "muted" }, "You didn't answer this one."))
      : h("div", { class: "card" },
          state.phase === "closed" ? h("p", { class: "muted" }, "Answers are closed.") : null,
          inputFor(state),
          state.guessesLeft !== null ? h("p", { class: "muted" }, `Guesses left: ${state.guessesLeft}`) : null),
    revealBlock(it),
    themeCard(state), board(state));
}

let lastSig = "";
async function refresh() {
  try {
    const state = await api("/api/play/state");
    // Don't yank the keyboard away mid-typing when nothing that matters changed.
    const sig = JSON.stringify([state.phase, state.number, state.guessesLeft, state.theme?.revealed, state.theme?.guessesLeft, state.myAnswers.length, state.leaderboard?.length, state.stake?.options]);
    if (sig === lastSig && document.activeElement?.closest("#app") && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    lastSig = sig;
    render(state);
  }
  catch (e) { if (e.status === 401) location.href = "/"; }
}
refresh();
live("/api/play/events", refresh);
