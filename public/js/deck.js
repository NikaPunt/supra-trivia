import { $, api, h, live, mount, questionBlock, revealBlock, scene } from "./common.js";
const id = new URLSearchParams(location.search).get("id");

function board(s) {
  return s.leaderboard ? h("div", { class: "card" }, h("h2", {}, s.phase === "ended" ? "Final scores" : "Scores after this round"),
    s.leaderboard.map((r, i) => h("div", { class: "rank" }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points)))) : null;
}

function themeBanner(s) {
  const t = s.theme;
  if (!t) return null;
  if (t.revealed) return h("div", { class: "card theme-card" }, h("h2", {}, "The secret theme"), h("p", {}, h("strong", {}, t.secret)), t.formal ? h("p", {}, t.formal) : null);
  return h("p", { class: "muted" }, `There is a secret theme linking every question${t.hint ? ` (hint: ${t.hint})` : ""}. Guess it on your phone for bonus points.`);
}

function render(s) {
  if (s.phase === "lobby") return mount($("#app"), scene(), h("h1", {}, s.title), h("p", {}, `Join at ${location.host}`), h("div", { class: "code" }, s.code), h("p", { class: "muted" }, `${s.players} at the table`), themeBanner(s));
  if (s.phase === "ended") return mount($("#app"), scene(), h("div", { class: "toast" }, "გაუმარჯოს!"), themeBanner(s), board(s));
  const it = s.item;
  mount($("#app"),
    questionBlock(it, `${it.round} · ${s.number}/${s.total} · room ${s.code}`),
    it.public.options ? h("ol", {}, it.public.options.map((o) => h("li", {}, o))) : null,
    s.phase === "revealed" ? revealBlock(it) : h("p", { class: "muted" }, s.phase === "closed" ? "Answers closed" : `${s.answered}/${s.players} locked in`),
    themeBanner(s), board(s));
}

async function refresh() { try { render(await api(`/api/sessions/${id}/deck`)); } catch (e) { mount($("#app"), h("p", { class: "err" }, e.message)); } }
refresh();
live(`/api/sessions/${id}/events`, refresh);
