import { $, api, h, hostHeader, mount } from "./common.js";
const me = await hostHeader($("#bar"));
if (me.role !== "admin") location.href = "/host.html";

const when = (t) => (t ? new Date(t).toLocaleString() : "never");
const ago = (t) => {
  if (!t) return "never";
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};
const size = (b) => (b < 1e6 ? `${Math.round(b / 1e3)} KB` : `${(b / 1e6).toFixed(1)} MB`);
const lasting = (ms) => { const hrs = ms / 3.6e6; return hrs < 1 ? `${Math.round(ms / 60000)} min` : hrs < 48 ? `${Math.round(hrs)} h` : `${Math.round(hrs / 24)} days`; };
const days = (n) => (n > 0 ? `deleted after ${n} days` : "kept forever");

// What each audit action means, in words. Anything not listed is shown as it is stored.
const ACTIONS = {
  "auth.login": "signed in", "auth.login_denied": "sign-in refused (not a host)", "auth.logout": "signed out", "auth.logout_all": "signed out everywhere",
  "admin.host_signout": "signed a host out everywhere", "admin.audit_export": "downloaded the audit log",
  "trivia.create": "created a trivia", "trivia.edit": "saved a trivia", "trivia.delete": "deleted a trivia", "trivia.duplicate": "copied a trivia",
  "session.create": "opened a session", "session.begin": "started the game", "session.end": "ended a session", "session.kick": "removed a player",
  "session.lock": "closed the room", "session.unlock": "reopened the room", "session.letin": "lifted a PIN lock", "session.theme_reveal": "revealed the theme",
  "session.record_view": "opened a session record", "session.purged": "old session deleted",
};
const detailText = (raw) => {
  if (!raw) return "";
  try {
    const d = JSON.parse(raw);
    return Object.entries(d).filter(([k]) => k !== "others").map(([k, v]) => `${k}: ${v}`).join(" · ");
  } catch { return raw; }
};
const onOthers = (raw) => { try { return !!JSON.parse(raw ?? "{}").others; } catch { return false; } };

const view = { sessions: "active", shown: 25, q: "", audit: [], more: false, loading: false };
let data = null;

async function loadAudit(reset) {
  if (view.loading) return;
  view.loading = true;
  try {
    const before = !reset && view.audit.length ? `&before=${view.audit[view.audit.length - 1].id}` : "";
    const r = await api(`/api/admin/audit?limit=50${before}${view.q ? `&q=${encodeURIComponent(view.q)}` : ""}`);
    view.audit = reset ? r.rows : [...view.audit, ...r.rows];
    view.more = r.more;
  } finally { view.loading = false; }
}

async function load() {
  const [overview, sessions, trivias] = await Promise.all([api("/api/admin/overview"), api("/api/sessions?all=1"), api("/api/trivias?all=1")]);
  data = { ...overview, sessions, trivias };
  await loadAudit(true);
  draw();
}

function statusCard() {
  const s = data.status;
  const stat = (label, value, note) => h("div", { class: "stat" }, h("div", { class: "eyebrow" }, label), h("div", { class: "num" }, value), note ? h("div", { class: "muted" }, note) : null);
  return [
    s.unreadableGames.length ? h("div", { class: "card warn", role: "alert" }, h("strong", {}, `${s.unreadableGames.length} stored session${s.unreadableGames.length === 1 ? "" : "s"} could not be read at start and ${s.unreadableGames.length === 1 ? "was" : "were"} skipped. `),
      "Nothing was deleted: they are still in the database. The server log names the reason for each. ", h("span", { class: "muted" }, s.unreadableGames.join(", "))) : null,
    h("div", { class: "stats" },
      stat("Sessions", `${s.sessions.active} live`, `${s.sessions.finished} finished · ${days(s.retention.sessionsDays)}`),
      stat("Trivias", s.trivias, `${s.drafts} with an unsaved draft`),
      stat("Connected now", s.liveConnections, "screens with a live connection"),
      stat("Database", size(s.dbBytes), `structure version ${s.schema}`),
      stat("Server", `up ${lasting(Date.now() - s.startedAt)}`, `version ${s.version} · ${size(s.memoryBytes)} of memory`),
      stat("Audit log", s.auditEntries, `entries · ${days(s.retention.auditDays)}`)),
    h("p", { class: "muted" }, "This page cannot see your backups. Check the backup log on the server; docs/DEPLOY.md has the steps."),
  ];
}

function sessionsCard() {
  const live = data.sessions.filter((s) => s.phase !== "ended"), done = data.sessions.filter((s) => s.phase === "ended");
  const list = view.sessions === "active" ? live : done;
  const tab = (key, label) => h("button", { role: "tab", "aria-selected": String(view.sessions === key), class: view.sessions === key ? "on" : "", onclick: () => { view.sessions = key; view.shown = 25; draw(); } }, label);
  return [
    h("h1", {}, "Sessions"),
    h("div", { class: "tabs", role: "tablist", "aria-label": "Sessions" }, tab("active", `Live (${live.length})`), tab("ended", `Finished (${done.length})`)),
    list.length ? h("table", { class: "stack" }, h("tr", {}, ["Code", "Title", "Host", "Players", "State", "Opened", ""].map((x) => h("th", {}, x))),
      list.slice(0, view.shown).map((s) => h("tr", {}, h("td", {}, s.code), h("td", {}, s.title), h("td", {}, s.host), h("td", { "data-label": "Players" }, s.players), h("td", { "data-label": "State" }, s.phase), h("td", { class: "muted", title: when(s.createdAt), "data-label": "Opened" }, ago(s.createdAt)),
        h("td", {}, h("span", { class: "row" },
          s.phase !== "ended" ? h("a", { class: "btn", href: `/session.html?id=${s.id}` }, "Control") : null,
          h("a", { class: "btn", href: `/record.html?id=${s.id}` }, "Record"),
          s.phase !== "ended" ? h("button", { class: "danger", onclick: async () => { if (confirm(`End session ${s.code} ("${s.title}", hosted by ${s.host}) for everyone? This cannot be undone and is logged.`)) { try { await api(`/api/sessions/${s.id}/action`, { method: "POST", body: { action: "end" } }); } catch (e) { alert(e.message); } load(); } } }, "End") : null))))) : h("p", { class: "muted" }, view.sessions === "active" ? "No session is running." : "No finished sessions."),
    list.length > view.shown ? h("button", { onclick: () => { view.shown += 50; draw(); } }, `Show more (${list.length - view.shown} left)`) : null,
  ];
}

function triviasCard() {
  return [
    h("h1", {}, "Trivias"),
    data.trivias.length ? h("table", { class: "stack" }, h("tr", {}, ["Title", "Owner", "Last saved", ""].map((x) => h("th", {}, x))),
      data.trivias.map((t) => h("tr", {}, h("td", {}, t.title), h("td", {}, t.owner), h("td", { class: "muted", title: when(t.updated_at), "data-label": "Last saved" }, ago(t.updated_at)),
        h("td", {}, h("span", { class: "row" }, h("a", { class: "btn", href: `/builder.html?id=${t.id}` }, "Edit"),
          h("button", { class: "danger", onclick: async () => { if (confirm(`Delete "${t.title}" by ${t.owner}? This cannot be undone and is logged.`)) { try { await api(`/api/trivias/${t.id}`, { method: "DELETE" }); } catch (e) { alert(e.message); } load(); } } }, "Delete")))))) : h("p", { class: "muted" }, "None."),
  ];
}

function hostsCard() {
  return [
    h("h1", {}, "Hosts"),
    h("p", { class: "muted" }, "Who may host is the list in config/hosts.json on the server; a change there applies at once, and removing someone locks them out at once. Sign-in times are known from when this log began."),
    h("table", { class: "stack" }, h("tr", {}, ["Email", "Role", "Last signed in", "Trivias", "Sessions", ""].map((x) => h("th", {}, x))),
      data.hosts.map((x) => h("tr", {}, h("td", {}, x.email), h("td", {}, h("span", { class: `badge ${x.role}` }, x.role)), h("td", { class: "muted", title: when(x.lastLogin), "data-label": "Last signed in" }, ago(x.lastLogin)), h("td", { "data-label": "Trivias" }, x.trivias),
        h("td", { "data-label": "Sessions" }, x.active ? `${x.sessions} (${x.active} live)` : x.sessions),
        h("td", {}, h("button", { title: "End every sign-in this host has, on every device. They can sign in again.", onclick: async () => {
          if (!confirm(`Sign ${x.email} out on every device? Their running sessions and players are not affected, and they can sign in again. This is logged.`)) return;
          try { await api("/api/admin/hosts/signout", { method: "POST", body: { email: x.email } }); } catch (e) { alert(e.message); }
          load();
        } }, "Sign out everywhere"))))),
  ];
}

function auditCard() {
  const search = h("input", { type: "search", value: view.q, placeholder: "Filter by person, action, room code, title…", "aria-label": "Filter the audit log", style: "max-width:24rem" });
  let timer;
  search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(async () => { view.q = search.value.trim(); await loadAudit(true); draw(); const el = $("#audit input"); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }, 300); });
  return h("section", { id: "audit" },
    h("h1", {}, "Audit log"),
    h("p", { class: "muted" }, "Everything hosts and admins change: sign-ins, trivias created, saved and deleted, sessions opened, started and ended, players removed. Entries cannot be edited or removed from here. What players answered is in each session's Record."),
    h("div", { class: "row" }, search, h("span", { class: "grow" }), h("a", { class: "btn", href: "/api/admin/audit.csv", download: "trivia-audit.csv" }, "Download all (CSV)")),
    view.audit.length ? h("table", { class: "stack" }, h("tr", {}, ["When", "Who", "Did", "On", "Details", "From"].map((x) => h("th", {}, x))),
      view.audit.map((a) => h("tr", {}, h("td", { title: when(a.at) }, when(a.at)), h("td", {}, a.actor),
        h("td", {}, ACTIONS[a.action] ?? a.action, onOthers(a.detail) ? h("span", { class: "badge admin", title: "An admin acting on somebody else's trivia or session" }, "as admin") : null),
        h("td", { class: "muted" }, a.target), h("td", { class: "muted" }, detailText(a.detail)), a.ip ? h("td", { class: "muted", "data-label": "From" }, a.ip) : h("td", {})))) : h("p", { class: "muted" }, view.q ? "Nothing matches." : "Nothing yet."),
    view.more ? h("button", { onclick: async () => { await loadAudit(false); draw(); } }, "Show older") : null);
}

function draw() {
  mount($("#app"),
    h("div", { class: "row" }, h("h1", { class: "grow" }, "Overview"), h("button", { onclick: load }, "Refresh")),
    statusCard(), sessionsCard(), triviasCard(), hostsCard(), auditCard());
}
load().catch((e) => mount($("#app"), h("p", { class: "err" }, e.message)));
