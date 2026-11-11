import { $, api, h, mount, scene } from "./common.js";
$("#hero").append(scene());
$("#code").value = new URLSearchParams(location.search).get("code") ?? "";
$("#join").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/join", { method: "POST", body: { code: $("#code").value, nickname: $("#nick").value, pin: $("#pin").value || undefined } });
    location.href = "/play.html";
  } catch (err) { $("#err").textContent = err.message; }
});

// Hosts who are already signed in get a way straight to their trivias; everyone else gets a clear way to log in.
api("/api/me").then(({ host }) => {
  mount($("#host"), host
    ? [h("div", { class: "grow" }, h("strong", {}, `Welcome back, ${host.name}`), h("p", { class: "muted" }, "You are signed in as a host.")),
       h("a", { class: "btn primary", href: "/host.html" }, "Go to my trivias")]
    : [h("div", { class: "grow" }, h("strong", {}, "Hosting a trivia?"), h("p", { class: "muted" }, "Log in with Google to build and run your own.")),
       h("a", { class: "btn primary", href: "/auth/login" }, "Log in to host")]);
}).catch(() => { $("#host").remove(); });

// A phone that is already at a table gets a way straight back, so a stray visit to this page never strands a team that set no PIN.
api("/api/play/where").then(({ table }) => {
  if (!table || table.phase === "ended") return;
  $("#resume").hidden = false;
  mount($("#resume"),
    h("div", { class: "grow" }, h("strong", {}, `You are at the table as ${table.me}`), h("p", { class: "muted" }, `Room ${table.code}`)),
    h("a", { class: "btn primary", href: "/play.html" }, "Back to my game"));
}).catch(() => {});
