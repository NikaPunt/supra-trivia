import { $, api, h, hostHeader, mount } from "./common.js";
const me = await hostHeader($("#bar"));
if (me.role !== "admin") location.href = "/host.html";

const when = (t) => new Date(t).toLocaleString();

async function render() {
  const [{ hosts, audit }, sessions, trivias] = await Promise.all([api("/api/admin/overview"), api("/api/sessions?all=1"), api("/api/trivias?all=1")]);
  mount($("#app"),
    h("h1", {}, "All sessions"),
    sessions.length ? h("table", {}, h("tr", {}, ["Code", "Title", "Host", "Players", "State", ""].map((x) => h("th", {}, x))),
      sessions.map((s) => h("tr", {}, h("td", {}, s.code), h("td", {}, s.title), h("td", {}, s.host), h("td", {}, s.players), h("td", {}, s.phase),
        h("td", {}, h("a", { class: "btn", href: `/session.html?id=${s.id}` }, "Control"), " ",
          s.phase !== "ended" ? h("button", { class: "danger", onclick: async () => { if (confirm(`End ${s.code}?`)) { await api(`/api/sessions/${s.id}/action`, { method: "POST", body: { action: "end" } }); render(); } } }, "End") : null)))) : h("p", { class: "muted" }, "None."),
    h("h1", {}, "All trivias"),
    h("table", {}, trivias.map((t) => h("tr", {}, h("td", {}, t.title), h("td", {}, t.owner), h("td", {}, when(t.updated_at)),
      h("td", {}, h("a", { class: "btn", href: `/builder.html?id=${t.id}` }, "Edit"), " ",
        h("button", { class: "danger", onclick: async () => { if (confirm(`Delete "${t.title}" by ${t.owner}?`)) { await api(`/api/trivias/${t.id}`, { method: "DELETE" }); render(); } } }, "Delete"))))),
    h("h1", {}, "Hosts"),
    h("p", { class: "muted" }, "Edit config/hosts.json on the server to add or remove hosts; changes apply immediately."),
    h("table", {}, hosts.map((x) => h("tr", {}, h("td", {}, x.email), h("td", {}, x.role)))),
    h("h1", {}, "Audit log"),
    h("table", {}, audit.map((a) => h("tr", {}, h("td", {}, when(a.at)), h("td", {}, a.actor), h("td", {}, a.action), h("td", {}, a.target), h("td", { class: "muted" }, a.detail ?? "")))));
}
render();
