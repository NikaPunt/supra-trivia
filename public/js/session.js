import { $, api, describeAnswer, h, hostHeader, live, mount } from "./common.js";
await hostHeader($("#bar"));
const id = new URLSearchParams(location.search).get("id");

const act = (body) => async () => {
  try { await api(`/api/sessions/${id}/action`, { method: "POST", body }); await refresh(); } catch (e) { alert(e.message); }
};
const btn = (label, body, cls = "") => h("button", { class: cls, onclick: act(body) }, label);

function controls(s) {
  const phase = s.phase;
  return h("div", { class: "row" },
    phase === "lobby" ? btn("Start", { action: "begin" }, "primary") : null,
    phase === "open" ? [btn("Close answers", { action: "close" }), btn("Reveal", { action: "reveal" }, "primary")] : null,
    phase === "closed" ? [btn("Reopen", { action: "reopen" }), btn("Reveal", { action: "reveal" }, "primary")] : null,
    ["open", "closed", "revealed"].includes(phase) ? btn(s.number >= s.total ? "Finish" : "Next question", { action: "next" }, phase === "revealed" ? "primary" : "") : null,
    phase !== "ended" ? h("button", { class: "danger", onclick: () => { if (confirm("End this session for everyone?")) act({ action: "end" })(); } }, "End session") : null,
    h("a", { class: "btn", href: `/deck.html?id=${id}`, target: "_blank", rel: "noopener" }, "Open projector view"));
}

function render(s) {
  mount($("#banner"), s.hostEmail !== s.you ? h("div", { class: "banner" }, `Admin control: this session belongs to ${s.hostEmail}. Your actions are logged.`) : null);
  const it = s.item;
  mount($("#app"),
    h("div", { class: "card row" }, h("div", {}, h("div", { class: "muted" }, "Room code"), h("div", { class: "code" }, s.code)),
      h("div", { class: "grow" }, h("strong", {}, s.title), h("div", { class: "muted" }, `${s.phase} · ${s.players} players · join at ${location.origin}`))),
    controls(s),
    it ? h("div", { class: "card" }, h("div", { class: "muted" }, `${it.round} · ${it.label} · ${s.number}/${s.total}`), h("h2", {}, it.public.question),
      h("p", {}, h("strong", {}, "Answer: "), it.solution)) : null,
    it ? h("div", { class: "card" }, h("h2", {}, `Answers (${s.answers.length})`),
      s.answers.length ? h("table", {}, s.answers.map((a) => h("tr", {}, h("td", {}, a.nickname), h("td", {}, describeAnswer(it, a.value)),
        h("td", {}, a.status === "pending" ? "" : a.status === "approved" ? `✓ +${a.points}` : "✗"),
        h("td", {}, h("button", { class: "ok", onclick: act({ action: "review", answerId: a.id, approve: true }) }, "Approve"), " ", h("button", { class: "danger", onclick: act({ action: "review", answerId: a.id, approve: false }) }, "Reject"))))) : h("p", { class: "muted" }, "None yet.")) : null,
    h("div", { class: "card" }, h("h2", {}, "Players"), s.playerList.length ? h("table", {}, s.playerList.map((p) => h("tr", {},
      h("td", {}, p.kicked ? h("s", {}, p.nickname) : p.nickname), h("td", {}, p.answered ? "answered" : ""),
      h("td", {}, p.kicked ? "removed" : h("button", { class: "danger", onclick: () => { if (confirm(`Remove ${p.nickname}?`)) act({ action: "kick", playerId: p.id })(); } }, "Remove"))))) : h("p", { class: "muted" }, "Nobody yet.")),
    h("div", { class: "card" }, h("h2", {}, "Scores"), s.leaderboard.map((r, i) => h("div", { class: "rank" }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points)))));
}

async function refresh() {
  try { render(await api(`/api/sessions/${id}`)); } catch (e) { mount($("#app"), h("p", { class: "err" }, e.message)); }
}
refresh();
live(`/api/sessions/${id}/events`, refresh);
