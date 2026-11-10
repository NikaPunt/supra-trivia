import { $, api, h, hostHeader, mount } from "./common.js";
await hostHeader($("#bar"));
const id = new URLSearchParams(location.search).get("id");
const when = (t) => (t ? new Date(t).toLocaleString() : "");
const fmt = (n) => (n > 0 ? `+${n}` : String(n));

function download(name, type, text) {
  const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** One row per answer. Cells a spreadsheet would run as a formula are defused: team names and answers are typed by players. */
function toCsv(r) {
  const cell = (v) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const rows = [["number", "round", "section", "type", "question", "right answer", "team", "answered", "result", "points", "set by host", "wager", "time"]];
  for (const rec of r.records) {
    if (rec.kind === "question") {
      const q = rec.data;
      for (const a of q.answers) rows.push([q.number, q.round, q.section ?? "", q.label, q.question, q.solution, a.team, a.answer, a.status, a.points, a.marked ? "yes" : "", q.wagers?.[a.team] ?? "", new Date(a.at).toISOString()]);
      for (const [team, lost] of Object.entries(q.forfeits ?? {})) rows.push([q.number, q.round, q.section ?? "", q.label, q.question, q.solution, team, "", "no answer", -lost, "", lost, ""]);
    } else if (rec.kind === "theme") {
      for (const g of rec.data.guesses) rows.push(["theme", "", "", "Secret theme", "", rec.data.secret, g.team, g.guess, g.status, g.points, "", "", ""]);
    }
  }
  rows.push([], ["final", "", "", "", "", "", "team", "", "", "points"]);
  for (const x of r.leaderboard) rows.push(["final", "", "", "", "", "", x.nickname, "", "", x.points]);
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

function question(rec) {
  const q = rec.data;
  const silent = Object.entries(q.forfeits ?? {});
  return h("div", { class: "card" },
    h("div", { class: "eyebrow" }, `Question ${q.number} · ${q.round}${q.section ? ` · ${q.section}` : ""} · ${q.label}`),
    h("p", { style: "white-space:pre-wrap" }, q.question),
    h("p", {}, h("strong", {}, "Answer: "), q.solution),
    q.answers.length ? h("table", { class: "stack" }, h("tr", {}, ["Team", "Answered", "Result", "Points"].map((x) => h("th", {}, x))),
      q.answers.map((a) => h("tr", {}, h("td", {}, a.team), h("td", {}, a.answer),
        h("td", { class: "muted" }, a.status === "approved" ? "right" : a.status === "rejected" ? "wrong" : "not marked", a.marked ? " (set by the host)" : ""), h("td", {}, fmt(a.points))))) : h("p", { class: "muted" }, "Nobody answered."),
    silent.length ? h("p", { class: "muted" }, "Wagered and did not answer: " + silent.map(([t, w]) => `${t} (${fmt(-w)})`).join(", ")) : null,
    q.guesses.length > q.answers.length ? h("details", {}, h("summary", {}, `Every guess, in order (${q.guesses.length})`),
      h("table", { class: "stack" }, q.guesses.map((g) => h("tr", {}, h("td", {}, g.team), h("td", {}, g.answer), h("td", { class: "muted" }, when(g.at)))))) : null);
}

function theme(rec) {
  const t = rec.data;
  return h("div", { class: "card theme-card" }, h("div", { class: "eyebrow" }, `Secret theme · made public at question ${t.atNumber}`), h("p", {}, h("strong", {}, t.secret)),
    t.guesses.length ? h("table", { class: "stack" }, h("tr", {}, ["Team", "Guessed", "At question", "Result"].map((x) => h("th", {}, x))),
      t.guesses.map((g) => h("tr", {}, h("td", {}, g.team), h("td", {}, g.guess), h("td", { class: "muted" }, g.atNumber), h("td", {}, g.points > 0 ? `approved ${fmt(g.points)}` : g.status === "pending" ? "not marked" : "rejected")))) : h("p", { class: "muted" }, "Nobody guessed."));
}

try {
  const r = await api(`/api/sessions/${id}/record`);
  const name = `trivia-${r.code}-${new Date(r.createdAt).toISOString().slice(0, 10)}`;
  const recorded = new Set(r.records.filter((x) => x.kind === "question").map((x) => x.data.number));
  const bare = r.history.filter((x) => !recorded.has(x.number)); // finished before answers were kept
  mount($("#app"),
    h("div", { class: "row" }, h("div", { class: "grow" }, h("h1", {}, r.title), h("p", { class: "muted" }, `Room ${r.code} · hosted by ${r.host} · opened ${when(r.createdAt)}${r.endedAt ? ` · ended ${when(r.endedAt)}` : ` · ${r.phase}, still running`}`)),
      h("button", { onclick: () => download(`${name}.csv`, "text/csv;charset=utf-8", toCsv(r)) }, "Download CSV"),
      h("button", { onclick: () => download(`${name}.json`, "application/json", JSON.stringify(r, null, 2)) }, "Download JSON"),
      r.phase !== "ended" ? h("a", { class: "btn primary", href: `/session.html?id=${id}` }, "Back to the console") : null),
    r.phase !== "ended" ? h("p", { class: "muted" }, "This session is still running: a question appears here once you move on from it.") : null,
    h("div", { class: "card" }, h("h2", {}, r.phase === "ended" ? "Final scores" : "Scores so far"),
      r.leaderboard.length ? r.leaderboard.map((x, i) => h("div", { class: "rank" }, h("span", {}, `${i + 1}. ${x.nickname}`), h("span", {}, x.points))) : h("p", { class: "muted" }, "Nobody played."),
      r.players.some((p) => p.removed) ? h("p", { class: "muted" }, "Removed during the game: " + r.players.filter((p) => p.removed).map((p) => p.nickname).join(", ")) : null),
    r.records.map((rec) => (rec.kind === "question" ? question(rec) : rec.kind === "theme" ? theme(rec) : null)),
    bare.length ? h("div", { class: "card" }, h("h2", {}, "Points per question"),
      h("p", { class: "muted" }, "These questions were played before the app kept each team's answers, so only the points are known."),
      h("table", { class: "stack" }, bare.map((x) => h("tr", {}, h("td", {}, `Question ${x.number}`), h("td", { class: "muted" }, x.round),
        h("td", {}, Object.entries(x.points).map(([t, p]) => `${t} ${fmt(p)}`).join(", ") || "no answers"))))) : null);
} catch (e) { mount($("#app"), h("p", { class: "err" }, e.status === 404 ? "No such session, or it is not yours." : e.message)); }
