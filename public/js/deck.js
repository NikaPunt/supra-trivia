import { $, api, h, live, mount } from "./common.js";
const id = new URLSearchParams(location.search).get("id");

function board(s) {
  return s.leaderboard ? h("div", { class: "card" }, h("h2", {}, s.phase === "ended" ? "Final scores" : "Scores"),
    s.leaderboard.map((r, i) => h("div", { class: "rank" }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points)))) : null;
}

function render(s) {
  if (s.phase === "lobby") return mount($("#app"), h("h1", {}, s.title), h("p", {}, `Join at ${location.host}`), h("div", { class: "code" }, s.code), h("p", {}, `${s.players} joined`));
  if (s.phase === "ended") return mount($("#app"), h("h1", {}, "Thanks for playing!"), board(s));
  const it = s.item;
  mount($("#app"), h("div", { class: "muted" }, `${it.round} · ${s.number}/${s.total} · room ${s.code}`),
    h("div", { class: "q" }, it.public.question),
    it.public.hint ? h("p", { class: "muted" }, `Hint: ${it.public.hint}`) : null,
    it.public.options ? h("ol", {}, it.public.options.map((o) => h("li", {}, o))) : null,
    s.phase === "revealed" ? h("p", {}, h("strong", {}, "Answer: "), it.solution) : h("p", { class: "muted" }, s.phase === "closed" ? "Answers closed" : `${s.answered}/${s.players} answered`),
    board(s));
}

async function refresh() { try { render(await api(`/api/sessions/${id}/deck`)); } catch (e) { mount($("#app"), h("p", { class: "err" }, e.message)); } }
refresh();
live(`/api/sessions/${id}/events`, refresh);
