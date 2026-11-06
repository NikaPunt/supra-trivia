import { $, api, h, live, mount } from "./common.js";

let picked = null;
let lastKey = "";

function board(state) {
  if (!state.leaderboard) return null;
  return h("div", { class: "card" }, h("h2", {}, state.phase === "ended" ? "Final scores" : "Scores"),
    state.leaderboard.map((r, i) => h("div", { class: `rank ${r.me ? "me" : ""}` }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points))),
    state.myRank && state.myRank > 10 ? h("p", { class: "muted" }, `You are #${state.myRank}`) : null);
}

function inputFor(state) {
  const { item } = state;
  const err = h("p", { class: "err", id: "err" });
  const send = async (value) => {
    try { await api("/api/play/answer", { method: "POST", body: { value } }); err.textContent = ""; await refresh(); }
    catch (e) { err.textContent = e.message; }
  };
  const open = state.phase === "open";
  const mine = state.myAnswers;
  if (item.input.kind === "choice") {
    const cur = mine[0]?.value[item.input.key];
    return h("div", {}, h("div", { class: "choices" }, item.public.options.map((o, i) =>
      h("button", { class: i === cur ? "picked" : "", disabled: !open, onclick: () => send({ [item.input.key]: i }) }, o))), err);
  }
  const field = h("input", { type: item.input.kind === "number" ? "number" : "text", step: "any", maxlength: 200, disabled: !open, autocomplete: "off",
    value: item.input.multi ? "" : (mine[0]?.value[item.input.key] ?? "") });
  const submit = () => {
    const raw = field.value.trim();
    if (!raw) return;
    send({ [item.input.key]: item.input.kind === "number" ? Number(raw) : raw }).then(() => { if (item.input.multi) field.value = ""; });
  };
  field.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return h("div", {}, field, h("div", { class: "row", style: "margin-top:8px" }, h("button", { class: "primary", disabled: !open, onclick: submit }, item.input.multi ? "Send guess" : "Lock in")), err);
}

function render(state) {
  const key = JSON.stringify([state.phase, state.number, state.item?.type]);
  const head = h("div", { class: "row" }, h("strong", {}, state.me), h("span", { class: "grow" }), h("span", { class: "muted" }, `Room ${state.code}`));
  if (state.phase === "lobby") return mount($("#app"), head, h("div", { class: "card" }, h("h1", {}, state.title), h("p", {}, `Waiting for the host to start… ${state.players} joined.`)));
  if (state.phase === "ended") return mount($("#app"), head, h("h1", {}, "That's a wrap!"), board(state));
  const it = state.item;
  const mine = state.myAnswers;
  mount($("#app"), head,
    h("div", { class: "card" },
      h("div", { class: "muted" }, `${it.round} · ${state.number}/${state.total}`),
      h("h1", {}, it.public.question),
      it.public.hint ? h("p", { class: "muted" }, `Hint: ${it.public.hint}`) : null,
      state.phase === "open" ? null : h("p", { class: "muted" }, state.phase === "closed" ? "Answers are closed." : "Revealed."),
      inputFor(state),
      mine.length && it.input.multi ? h("div", {}, h("h2", {}, "Your guesses"), mine.map((a) => h("div", {}, `${a.value[it.input.key]}${a.status ? (a.status === "approved" ? ` ✓ +${a.points}` : " ✗") : ""}`))) : null,
      mine.length && !it.input.multi && mine[0].status ? h("p", {}, mine[0].status === "approved" ? `Correct! +${mine[0].points}` : "Not this time.") : null,
      it.solution ? h("p", {}, h("strong", {}, "Answer: "), it.solution) : null),
    board(state));
  lastKey = key;
}

async function refresh() {
  try { render(await api("/api/play/state")); }
  catch (e) { if (e.status === 401) location.href = "/"; }
}
refresh();
live("/api/play/events", refresh);
