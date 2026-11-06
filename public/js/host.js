import { $, api, h, hostHeader, mount } from "./common.js";
const me = await hostHeader($("#bar"));

async function render() {
  const [trivias, sessions] = await Promise.all([api("/api/trivias"), api("/api/sessions")]);
  const live = sessions.filter((s) => s.phase !== "ended");
  mount($("#app"),
    h("h1", {}, "Your sessions"),
    live.length ? live.map((s) => h("div", { class: "card row" }, h("strong", { class: "code", style: "font-size:1.4rem" }, s.code), h("span", { class: "grow" }, `${s.title} · ${s.players} players · ${s.phase}`),
      h("a", { class: "btn primary", href: `/session.html?id=${s.id}` }, "Open"))) : h("p", { class: "muted" }, "No active sessions."),
    h("div", { class: "row" }, h("h1", { class: "grow" }, "Your trivias"), h("a", { class: "btn primary", href: "/builder.html" }, "New trivia")),
    trivias.length ? trivias.map((t) => h("div", { class: "card row" }, h("span", { class: "grow" }, t.title),
      h("a", { class: "btn", href: `/builder.html?id=${t.id}` }, "Edit"),
      h("button", { class: "primary", onclick: async () => {
        try { const s = await api(`/api/trivias/${t.id}/sessions`, { method: "POST" }); location.href = `/session.html?id=${s.id}`; }
        catch (e) { alert(e.message); }
      } }, "Host live"),
      h("button", { class: "danger", onclick: async () => { if (confirm(`Delete "${t.title}"?`)) { await api(`/api/trivias/${t.id}`, { method: "DELETE" }); render(); } } }, "Delete"))) : h("p", { class: "muted" }, "No trivias yet."));
}
render();
