import { $, api, h, live, mount, questionBlock, revealBlock, scene, themeNote } from "./common.js";
const id = new URLSearchParams(location.search).get("id");
// The projector scales with the screen, so a 4K display is not a small column on a big black field.
document.documentElement.classList.add("deck");

function board(s) {
  return s.leaderboard ? h("div", { class: "card" }, h("h2", {}, s.phase === "ended" ? "Final scores" : "Scores after this round"),
    s.leaderboard.map((r, i) => h("div", { class: "rank" }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points)))) : null;
}

const foot = (s) => h("div", { class: "ft" }, h("span", {}, `Join at ${location.host}`), h("span", {}, `Room ${s.code}`));

function render(s) {
  if (s.phase === "lobby") return mount($("#app"), scene(), h("h1", {}, s.title), h("p", { class: "muted" }, `Join at ${location.host}`), h("div", { class: "code" }, s.code), h("p", { class: "muted" }, `${s.players} at the table`), themeNote(s.theme));
  if (s.phase === "ended") {
    return mount($("#app"), scene(), h("div", { class: "toast" }, h("span", { class: "geo" }, "გაუმარჯოს!"), h("span", { class: "plain" }, "Thanks for playing!")), themeNote(s.theme), board(s), foot(s));
  }
  const it = s.item;
  mount($("#app"),
    questionBlock(it),
    it.public.options ? h("ol", {}, it.public.options.map((o) => h("li", {}, o))) : null,
    s.phase === "revealed" ? revealBlock(it) : h("p", { class: "muted" }, s.phase === "closed" ? "Answers closed" : `${s.answered}/${s.players} locked in`),
    themeNote(s.theme), board(s), foot(s));
}

async function refresh() { try { render(await api(`/api/sessions/${id}/deck`)); } catch (e) { mount($("#app"), h("p", { class: "err" }, e.message)); } }
refresh();
live(`/api/sessions/${id}/events`, refresh);
