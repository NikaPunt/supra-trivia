import { $, api, describeAnswer, enterIfChanged, h, hostHeader, live, mount, questionBlock, revealBlock } from "./common.js";
await hostHeader($("#bar"));
const id = new URLSearchParams(location.search).get("id");

const act = (body) => async () => {
  try { await api(`/api/sessions/${id}/action`, { method: "POST", body }); await refresh(); } catch (e) { alert(e.message); }
};
const btn = (label, body, cls = "") => h("button", { class: cls, onclick: act(body) }, label);
const fmt = (n) => (n > 0 ? `+${n}` : String(n));

function controls(s) {
  const phase = s.phase;
  const last = s.number >= s.total;
  return h("div", { class: "row" },
    phase === "lobby" ? btn("Start", { action: "begin" }, "primary") : null,
    phase === "open" ? [btn("Close answers", { action: "close" }), btn("Reveal", { action: "reveal" }, "primary")] : null,
    phase === "closed" ? [btn("Reopen", { action: "reopen" }), btn("Reveal", { action: "reveal" }, "primary")] : null,
    ["open", "closed", "revealed"].includes(phase) ? btn(last ? "Finish" : s.roundEnd ? "Next round" : "Next question", { action: "next" }, phase === "revealed" ? "primary" : "") : null,
    phase !== "ended" ? h("button", { class: "danger", onclick: () => { if (confirm("End this session for everyone?")) act({ action: "end" })(); } }, "End session") : null,
    h("a", { class: "btn", href: `/deck.html?id=${id}`, target: "_blank", rel: "noopener" }, "Open projector view"));
}

const set = (a, points) => act({ action: "review", answerId: a.id, points });
function award(a) {
  const custom = h("input", { type: "number", step: "0.5", min: -1000, max: 1000, placeholder: "pts", style: "width:5em", "aria-label": "Custom points" });
  return h("span", { class: "row" },
    h("button", { class: "ok", onclick: set(a, a.full) }, `Right (${fmt(a.full)})`),
    a.full > 0 ? h("button", { onclick: set(a, a.full / 2) }, `Half (${fmt(a.full / 2)})`) : null,
    h("button", { class: "danger", onclick: set(a, a.wrong) }, `Wrong (${fmt(a.wrong)})`), custom,
    h("button", { onclick: () => { if (custom.value !== "") set(a, Number(custom.value))(); } }, "Set"));
}

function themePanel(s) {
  const t = s.theme;
  if (!t) return null;
  if (t.revealed) return h("div", { class: "card theme-card" }, h("h2", {}, "Secret theme (revealed)"), h("p", {}, h("strong", {}, t.secret)),
    t.bonuses.length ? h("p", { class: "muted" }, "Bonuses: " + t.bonuses.map((b) => `${b.nickname} ${fmt(b.points)}`).join(", ")) : h("p", { class: "muted" }, "Nobody earned the bonus."));
  const custom = (g) => {
    const box = h("input", { type: "number", step: "0.5", min: 0, max: 1000, placeholder: "points", style: "width:6em", "aria-label": "Custom bonus points" });
    return h("span", { class: "row" }, box,
      h("button", { onclick: () => { if (box.value !== "") act({ action: "theme_review", guessId: g.id, points: Number(box.value) })(); } }, "Set"));
  };
  return h("div", { class: "card theme-card" }, h("h2", {}, "Secret theme"),
    h("p", {}, h("strong", {}, t.secret), t.hint ? h("span", { class: "muted" }, `  ·  hint: ${t.hint}`) : null),
    t.guesses.length ? h("table", { class: "stack" }, t.guesses.map((g) => h("tr", {},
      h("td", {}, g.nickname), h("td", {}, g.text), h("td", { class: "muted" }, `at question ${g.atNumber}`),
      h("td", {}, g.status === "pending" ? "" : g.points > 0 ? `approved ${fmt(g.points)}` : "rejected"),
      h("td", {}, h("span", { class: "row" },
        h("button", { class: "ok", onclick: act({ action: "theme_review", guessId: g.id, points: g.suggested }) }, `Approve (${fmt(g.suggested)})`),
        custom(g),
        h("button", { class: "danger", onclick: act({ action: "theme_review", guessId: g.id, points: 0 }) }, "Reject")))))) : h("p", { class: "muted" }, "No guesses yet."),
    h("p", { class: "muted" }, `Approve gives the suggested bonus: ${t.bonus} points for a guess at question 1, one less for each question after, never below 1. Or type any amount and press Set. Bonuses stay hidden until the theme goes public.`),
    h("button", { class: "primary", onclick: () => { if (confirm("Reveal the theme to everyone and count the bonuses?")) act({ action: "theme_reveal" })(); } }, "Reveal theme"));
}

function render(s) {
  mount($("#banner"), s.hostEmail !== s.you ? h("div", { class: "banner" }, `Admin control: this session belongs to ${s.hostEmail}. Your actions are logged.`) : null);
  const it = s.item;
  mount($("#app"),
    h("div", { class: "card row" }, h("div", {}, h("div", { class: "eyebrow" }, "Room code"), h("div", { class: "code" }, s.code)),
      h("div", { class: "grow" }, h("strong", {}, s.title), h("div", { class: "muted" }, `${s.phase} · ${s.players} players · ${s.maxGuesses === 0 ? "unlimited" : s.maxGuesses} guesses each · join at ${location.origin}`))),
    controls(s),
    it ? h("div", {}, h("div", { class: "eyebrow", style: "margin-top:1.1rem" }, `${it.label}${s.roundEnd ? " · last of round: the scoreboard shows on reveal" : ""}`), questionBlock(it)) : null,
    it ? revealBlock(it) : null,
    it ? h("div", { class: "card" }, h("h2", {}, `Answers (${s.answers.length})`),
      s.answers.length ? h("table", { class: "stack" }, s.answers.map((a) => h("tr", {}, h("td", {}, a.nickname),
        h("td", {}, describeAnswer(it, a.value), a.status === "pending" && a.suggest !== null ? h("span", { class: a.suggest > 0 ? "badge" : "muted" }, a.suggest > 0 ? "  looks right" : "  no match") : null),
        h("td", {}, a.status === "pending" ? "" : a.points > 0 ? `${fmt(a.points)}` : a.points < 0 ? `${a.points}` : "0"),
        h("td", {}, award(a))))) : h("p", { class: "muted" }, "None yet.")) : null,
    themePanel(s),
    h("div", { class: "card" }, h("h2", {}, "Players"), s.playerList.length ? h("table", { class: "stack" }, s.playerList.map((p) => h("tr", {},
      h("td", {}, p.kicked ? h("s", {}, p.nickname) : p.nickname), h("td", {}, p.answered ? "answered" : ""), h("td", { class: "muted" }, p.hasPin ? "PIN set" : ""),
      h("td", {}, p.kicked ? "removed" : h("button", { class: "danger", onclick: () => { if (confirm(`Remove ${p.nickname}?`)) act({ action: "kick", playerId: p.id })(); } }, "Remove"))))) : h("p", { class: "muted" }, "Nobody yet.")),
    h("div", { class: "card" }, h("h2", {}, "Scores"), s.leaderboard.map((r, i) => h("div", { class: "rank" }, h("span", {}, `${i + 1}. ${r.nickname}`), h("span", {}, r.points))),
      s.theme && !s.theme.revealed ? h("p", { class: "muted" }, "Theme bonuses are not included until the theme is revealed.") : null));
}

const anim = {};
let lastRaw = "";
let waiting = null; // a newer state, held back while the host is typing an amount
const typing = () => { const a = document.activeElement; return a && a.tagName === "INPUT" && $("#app").contains(a) && a.value !== ""; };
function draw(s) { lastRaw = JSON.stringify(s); waiting = null; render(s); enterIfChanged(`${s.number}:${s.phase}`, anim); }
document.addEventListener("focusout", () => setTimeout(() => { if (waiting && !typing()) draw(waiting); }, 0));
async function refresh() {
  try {
    const s = await api(`/api/sessions/${id}`);
    if (JSON.stringify(s) === lastRaw) return; // nothing changed: leave the page alone
    if (typing()) { waiting = s; return; }
    draw(s);
  } catch (e) { mount($("#app"), h("p", { class: "err" }, e.message)); }
}
refresh();
live(`/api/sessions/${id}/events`, refresh);
