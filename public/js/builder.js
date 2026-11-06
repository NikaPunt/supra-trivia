import { $, api, h, hostHeader, mount } from "./common.js";
await hostHeader($("#bar"));

const id = new URLSearchParams(location.search).get("id");
const mods = await api("/api/modules");
const byType = Object.fromEntries(mods.map((m) => [m.type, m]));
let state = { title: "My trivia", settings: { maxGuesses: 3 }, rounds: [{ title: "Round 1", modules: [] }] };
if (id) state = await api(`/api/trivias/${id}`);
state.settings ??= { maxGuesses: 3 };

// Form values are kept in `config` using the editor's friendly shapes; toApi() converts to what the server stores.
const blank = (type) => ({ type, maxGuesses: undefined, config: Object.fromEntries(byType[type].fields.map((f) => [f.key, f.kind === "list" ? [""] : (f.default ?? "")])) });
const toApi = () => ({
  title: state.title,
  settings: { maxGuesses: Number(state.settings.maxGuesses) },
  rounds: state.rounds.map((r) => ({ title: r.title, modules: r.modules.map((m) => ({ type: m.type, maxGuesses: m.maxGuesses === undefined || m.maxGuesses === "" ? undefined : Number(m.maxGuesses), config: Object.fromEntries(byType[m.type].fields.map((f) => {
    const v = m.config[f.key];
    if (f.kind === "list") return [f.key, (v ?? []).map((s) => s.trim()).filter(Boolean)];
    if (f.kind === "number") return [f.key, Number(v)];
    return [f.key, v];
  })) })) })),
});

let drag = null; // { from: "palette", type } | { from: "card", r, i }
function drop(toRound, toIndex) {
  if (!drag) return;
  let mod;
  if (drag.from === "palette") mod = blank(drag.type);
  else { mod = state.rounds[drag.r].modules.splice(drag.i, 1)[0]; if (drag.r === toRound && drag.i < toIndex) toIndex--; }
  state.rounds[toRound].modules.splice(toIndex ?? state.rounds[toRound].modules.length, 0, mod);
  drag = null; render();
}
const over = (el) => ({ ondragover: (e) => { e.preventDefault(); el.classList.add("over"); }, ondragleave: () => el.classList.remove("over") });

function fieldInput(m, f) {
  const v = m.config[f.key];
  const on = (fn) => (e) => { m.config[f.key] = fn(e.target.value); };
  if (f.kind === "textarea") return h("textarea", { rows: 2, value: v, oninput: on((x) => x) });
  if (f.kind === "list") return h("textarea", { rows: 4, value: v.join("\n"), oninput: on((x) => x.split("\n")) });
  if (f.kind === "index") return h("input", { type: "number", min: 1, value: Number(v) + 1, oninput: on((x) => Number(x) - 1) });
  if (f.kind === "number") return h("input", { type: "number", step: "any", value: v, oninput: on((x) => x) });
  return h("input", { type: "text", value: v, oninput: on((x) => x) });
}

function card(r, i, m) {
  const def = byType[m.type];
  const el = h("div", { class: "mod", draggable: "true" });
  el.addEventListener("dragstart", (e) => { drag = { from: "card", r, i }; e.dataTransfer.setData("text/plain", "m"); e.stopPropagation(); });
  el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); drop(r, i); });
  const move = (d) => () => { const a = state.rounds[r].modules; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; render(); };
  mount(el,
    h("div", { class: "head" }, h("strong", { class: "grow" }, `⠿ ${def.label}`), h("button", { onclick: move(-1), "aria-label": "Move up" }, "↑"), h("button", { onclick: move(1), "aria-label": "Move down" }, "↓"),
      h("button", { class: "danger", onclick: () => { state.rounds[r].modules.splice(i, 1); render(); }, "aria-label": "Remove" }, "✕")),
    def.fields.map((f) => h("div", {}, h("label", {}, f.label + (f.help ? ` (${f.help})` : "")), fieldInput(m, f))),
    h("div", {}, h("label", {}, "Max guesses for this question (blank = trivia default, 0 = unlimited)"),
      h("input", { type: "number", min: 0, max: 50, value: m.maxGuesses ?? "", oninput: (e) => { m.maxGuesses = e.target.value === "" ? undefined : Number(e.target.value); } })));
  return el;
}

function render() {
  const err = h("p", { class: "err", id: "err" });
  mount($("#app"),
    h("div", { class: "card" }, h("label", { for: "mg" }, "Guesses each player gets per question (0 = unlimited)"),
      h("input", { id: "mg", type: "number", min: 0, max: 50, value: state.settings.maxGuesses, oninput: (e) => { state.settings.maxGuesses = e.target.value; } }),
      h("p", { class: "muted" }, "Players never see whether a guess was right until you reveal. You can always award points by hand, including half marks.")),
    h("div", { class: "row" }, h("input", { class: "grow", value: state.title, maxlength: 120, "aria-label": "Trivia title", oninput: (e) => { state.title = e.target.value; } }),
      h("button", { class: "primary", onclick: save }, "Save"), h("a", { class: "btn", href: "/host.html" }, "Back")), err,
    h("div", { class: "builder" },
      h("aside", { class: "palette card" }, h("h2", {}, "Modules"), h("p", { class: "muted" }, "Drag onto a round, or click to add to the last round."),
        mods.map((m) => { const c = h("div", { class: "chip", draggable: "true", title: m.description, onclick: () => { state.rounds.at(-1).modules.push(blank(m.type)); render(); } }, m.label, h("small", {}, m.description));
          c.addEventListener("dragstart", (e) => { drag = { from: "palette", type: m.type }; e.dataTransfer.setData("text/plain", "p"); }); return c; })),
      h("section", {}, state.rounds.map((r, ri) => {
        const zone = h("div", { class: "dropzone" });
        Object.entries(over(zone)).forEach(([k, fn]) => zone.addEventListener(k.slice(2), fn));
        zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); drop(ri); });
        mount(zone, r.modules.map((m, i) => card(ri, i, m)), r.modules.length ? null : h("p", { class: "muted" }, "Drop modules here"));
        return h("div", { class: "round" }, h("div", { class: "row" }, h("input", { class: "grow", value: r.title, maxlength: 100, "aria-label": "Round title", oninput: (e) => { r.title = e.target.value; } }),
          state.rounds.length > 1 ? h("button", { class: "danger", onclick: () => { state.rounds.splice(ri, 1); render(); } }, "Remove round") : null), zone);
      }), h("button", { onclick: () => { state.rounds.push({ title: `Round ${state.rounds.length + 1}`, modules: [] }); render(); } }, "+ Add round"))));
}

async function save() {
  try {
    if (id) await api(`/api/trivias/${id}`, { method: "PUT", body: toApi() });
    else { const r = await api("/api/trivias", { method: "POST", body: toApi() }); location.href = `/builder.html?id=${r.id}`; return; }
    $("#err").textContent = "";
    $("#err").style.color = "var(--ok)"; $("#err").textContent = "Saved.";
  } catch (e) { $("#err").style.color = ""; $("#err").textContent = `Could not save: ${e.message}`; }
}
// Stored lists/index values already use the editor shapes except `index`, which is stored 0-based on both sides.
render();
