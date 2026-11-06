import { $, api, h, hostHeader, mount } from "./common.js";
await hostHeader($("#bar"));

const id = new URLSearchParams(location.search).get("id");
const mods = await api("/api/modules");
const byType = Object.fromEntries(mods.map((m) => [m.type, m]));
const TIERS = ["Layup", "Sweet Spot", "Stretch", "Separator"];
const CURVE = [0.2, 0.5, 0.2, 0.1]; // the 2-5-2-1 curve per 10 questions

let state = { title: "My trivia", settings: { maxGuesses: 3 }, rounds: [{ title: "Round 1", modules: [] }] };
if (id) state = await api(`/api/trivias/${id}`);
state.settings ??= { maxGuesses: 3 };

// The editor keeps friendly shapes (lists as arrays of raw lines, numbers as typed); toApi() cleans them for the server.
const defaultFor = (f) => (f.kind === "list" || f.kind === "numlist" ? (Array.isArray(f.default) ? [...f.default] : [""]) : (f.default ?? ""));
const blank = (type) => ({ type, section: undefined, maxGuesses: undefined, config: Object.fromEntries(byType[type].fields.map((f) => [f.key, defaultFor(f)])) });

function cleanConfig(def, config) {
  const out = {};
  for (const f of def.fields) {
    let v = config[f.key];
    if (f.kind === "list") v = (v ?? []).map((s) => String(s).trim()).filter(Boolean);
    else if (f.kind === "numlist") v = (v ?? []).map((s) => (typeof s === "number" ? s : s.trim() === "" ? NaN : Number(s))).filter(Number.isFinite);
    else if (f.kind === "number" || f.kind === "index") v = v === "" || v == null ? undefined : Number(v);
    if (f.optional && (v === "" || v == null)) continue;
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

function toApi() {
  const s = state.settings;
  return {
    title: state.title,
    settings: { maxGuesses: Number(s.maxGuesses), ...(s.theme && s.theme.secret?.trim() ? { theme: { secret: s.theme.secret.trim(), hint: s.theme.hint ?? "", formal: s.theme.formal ?? "" } } : {}) },
    rounds: state.rounds.map((r) => ({
      title: r.title,
      ...(r.subtitle ? { subtitle: r.subtitle } : {}),
      modules: r.modules.map((m) => ({
        type: m.type,
        ...(m.section ? { section: m.section } : {}),
        ...(m.maxGuesses === undefined || m.maxGuesses === "" ? {} : { maxGuesses: Number(m.maxGuesses) }),
        config: cleanConfig(byType[m.type], m.config),
      })),
    })),
  };
}

function load(data) {
  state = { title: data.title ?? "Imported trivia", settings: data.settings ?? { maxGuesses: 3 }, rounds: data.rounds ?? [] };
  if (!state.rounds.length) state.rounds = [{ title: "Round 1", modules: [] }];
  render();
}

// ---- drag and drop ----
let drag = null; // { from: "palette", type } | { from: "card", r, i }
function drop(toRound, toIndex) {
  if (!drag) return;
  let mod;
  if (drag.from === "palette") mod = blank(drag.type);
  else { mod = state.rounds[drag.r].modules.splice(drag.i, 1)[0]; if (drag.r === toRound && toIndex !== undefined && drag.i < toIndex) toIndex--; }
  state.rounds[toRound].modules.splice(toIndex ?? state.rounds[toRound].modules.length, 0, mod);
  drag = null; render();
}

function fieldInput(m, f) {
  const v = m.config[f.key];
  const on = (fn) => (e) => { m.config[f.key] = fn(e.target.value); };
  if (f.kind === "textarea") return h("textarea", { rows: 2, value: v ?? "", oninput: on((x) => x) });
  if (f.kind === "list" || f.kind === "numlist") return h("textarea", { rows: 4, value: (v ?? []).join("\n"), oninput: on((x) => x.split("\n")) });
  if (f.kind === "index") return h("input", { type: "number", min: 1, value: Number(v) + 1, oninput: on((x) => Number(x) - 1) });
  if (f.kind === "number") return h("input", { type: "number", step: "any", value: v ?? "", oninput: on((x) => x) });
  if (f.kind === "select") return h("select", { onchange: on((x) => x) }, h("option", { value: "" }, "(not set)"), f.options.map((o) => h("option", { value: o, selected: o === v }, o)));
  return h("input", { type: "text", value: v ?? "", oninput: on((x) => x) });
}

/** Checks a question against the quality checklist in docs/GUIDELINES.md. */
function warnings(m) {
  const c = m.config, w = [];
  if (!c.answerType) w.push("No answer type pinned: players may not know whether you want a city, person or year.");
  if (!c.clue2 && byType[m.type].fields.some((f) => f.key === "clue2")) w.push("No second clue: add a broader foothold for casual players.");
  if (!c.tier) w.push("No tier set, so it doesn't count towards the 2-5-2-1 curve.");
  if (!c.category) w.push("No category: rotate sub-genres within a theme.");
  if ("answers" in c && (c.answers ?? []).filter((a) => String(a).trim()).length < 2) w.push("Only one accepted answer: add common spellings or the last name only.");
  return w;
}

function card(r, i, m) {
  const def = byType[m.type];
  const el = h("div", { class: "mod", draggable: "true" });
  el.addEventListener("dragstart", (e) => { drag = { from: "card", r, i }; e.dataTransfer.setData("text/plain", "m"); e.stopPropagation(); });
  el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); drop(r, i); });
  const move = (d) => () => { const a = state.rounds[r].modules; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; render(); };
  const warn = warnings(m);
  mount(el,
    h("div", { class: "head" }, h("strong", { class: "grow" }, `⠿ ${i + 1}. ${def.label}`), h("button", { onclick: move(-1), "aria-label": "Move up" }, "↑"), h("button", { onclick: move(1), "aria-label": "Move down" }, "↓"),
      h("button", { class: "danger", onclick: () => { state.rounds[r].modules.splice(i, 1); render(); }, "aria-label": "Remove" }, "✕")),
    h("div", {}, h("label", {}, "Section (e.g. Hodgepodge, Before & After, Confidence Set)"), h("input", { type: "text", maxlength: 60, value: m.section ?? "", oninput: (e) => { m.section = e.target.value; } })),
    def.fields.map((f) => h("div", {}, h("label", {}, f.label + (f.help ? ` (${f.help})` : "")), fieldInput(m, f))),
    h("div", {}, h("label", {}, "Max guesses for this question (blank = trivia default, 0 = unlimited)"),
      h("input", { type: "number", min: 0, max: 50, value: m.maxGuesses ?? "", oninput: (e) => { m.maxGuesses = e.target.value === "" ? undefined : Number(e.target.value); } })),
    warn.length ? h("details", {}, h("summary", { class: "warnline" }, `${warn.length} suggestion${warn.length > 1 ? "s" : ""}`), warn.map((x) => h("div", { class: "warnline" }, x))) : null);
  return el;
}

/** Tallies a round against the 2-5-2-1 curve (scaled to its size). */
function meter(round) {
  const qs = round.modules;
  const n = qs.length;
  if (!n) return null;
  const counts = TIERS.map((t) => qs.filter((m) => m.config.tier === t).length);
  const untagged = n - counts.reduce((a, b) => a + b, 0);
  return h("div", { class: "meter" }, TIERS.map((t, k) => {
    const target = Math.round(n * CURVE[k]);
    return h("span", { class: `badge ${counts[k] === target ? "ok" : "warn"}` }, `${t} ${counts[k]}/${target}`);
  }), untagged ? h("span", { class: "badge" }, `${untagged} untiered`) : null, h("span", { class: "muted" }, `${n} questions · target curve 2-5-2-1 per 10`));
}

function themeCard() {
  const s = state.settings;
  const on = !!s.theme;
  return h("div", { class: "card theme-card" }, h("h2", {}, "Overall theme"),
    h("label", {}, h("input", { type: "checkbox", style: "width:auto", checked: on, onchange: (e) => { s.theme = e.target.checked ? { secret: "", hint: "", formal: "" } : undefined; render(); } }), " This trivia has a secret theme that links the questions"),
    on ? h("div", {},
      h("label", {}, "The theme (short, for you to grade guesses)"), h("input", { value: s.theme.secret, maxlength: 200, oninput: (e) => { s.theme.secret = e.target.value; } }),
      h("label", {}, "Hint players see"), h("input", { value: s.theme.hint ?? "", maxlength: 300, oninput: (e) => { s.theme.hint = e.target.value; } }),
      h("label", {}, "Formal explanation shown at the reveal"), h("textarea", { rows: 3, maxlength: 600, oninput: (e) => { s.theme.formal = e.target.value; } }, s.theme.formal ?? ""),
      h("p", { class: "muted" }, "Players can guess it any time once the game starts. You approve guesses (earlier ones suggest more points) and the bonus stays hidden until you reveal the theme.")) : null);
}

function render() {
  const total = state.rounds.reduce((a, r) => a + r.modules.length, 0);
  mount($("#app"),
    h("div", { class: "row" }, h("input", { class: "grow", value: state.title, maxlength: 120, "aria-label": "Trivia title", oninput: (e) => { state.title = e.target.value; } }),
      h("button", { class: "primary", onclick: save }, "Save"), h("a", { class: "btn", href: "/host.html" }, "Back")),
    h("p", { class: "err", id: "err" }),
    h("div", { class: "row" },
      h("span", { class: total > 50 ? "warnline" : "muted" }, `${total} questions${total > 50 ? ": over the 50-question cap, which tires players" : " (aim for 40-50 across 4-5 rounds, 60-90 minutes)"}`),
      h("span", { class: "grow" }),
      h("button", { onclick: exportJson }, "Export JSON"), h("button", { onclick: () => $("#file").click() }, "Import JSON"),
      !id && !total ? h("button", { onclick: loadSample }, "Load sample trivia") : null,
      h("input", { id: "file", type: "file", accept: "application/json,.json", style: "display:none", onchange: importFile })),
    h("div", { class: "card" }, h("label", { for: "mg" }, "Guesses each player gets per question (0 = unlimited)"),
      h("input", { id: "mg", type: "number", min: 0, max: 50, value: state.settings.maxGuesses, oninput: (e) => { state.settings.maxGuesses = e.target.value; } }),
      h("p", { class: "muted" }, "Players never see whether a guess was right until you reveal. You can always award points by hand, including half marks.")),
    themeCard(),
    h("div", { class: "builder" },
      h("aside", { class: "palette card" }, h("h2", {}, "Question types"), h("p", { class: "muted" }, "Drag onto a round, or click to add to the last round."),
        mods.map((m) => { const c = h("div", { class: "chip", draggable: "true", title: m.description, onclick: () => { state.rounds.at(-1).modules.push(blank(m.type)); render(); } }, m.label, h("small", {}, m.description));
          c.addEventListener("dragstart", (e) => { drag = { from: "palette", type: m.type }; e.dataTransfer.setData("text/plain", "p"); }); return c; })),
      h("section", {}, state.rounds.map((r, ri) => {
        const zone = h("div", { class: "dropzone" });
        zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("over"));
        zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); drop(ri); });
        mount(zone, r.modules.map((m, i) => card(ri, i, m)), r.modules.length ? null : h("p", { class: "muted" }, "Drop question types here"));
        return h("div", { class: "round" },
          h("div", { class: "row" }, h("input", { class: "grow", value: r.title, maxlength: 100, "aria-label": "Round title", oninput: (e) => { r.title = e.target.value; } }),
            state.rounds.length > 1 ? h("button", { class: "danger", onclick: () => { state.rounds.splice(ri, 1); render(); } }, "Remove round") : null),
          h("input", { value: r.subtitle ?? "", maxlength: 300, placeholder: "Round description shown to players (rules of its special categories)", "aria-label": "Round description", oninput: (e) => { r.subtitle = e.target.value; } }),
          meter(r), zone);
      }), h("button", { onclick: () => { state.rounds.push({ title: `Round ${state.rounds.length + 1}`, modules: [] }); render(); } }, "+ Add round"))));
}

async function save() {
  const err = $("#err");
  try {
    if (id) await api(`/api/trivias/${id}`, { method: "PUT", body: toApi() });
    else { const r = await api("/api/trivias", { method: "POST", body: toApi() }); location.href = `/builder.html?id=${r.id}`; return; }
    err.style.color = "var(--ok)"; err.textContent = "Saved.";
  } catch (e) { err.style.color = ""; err.textContent = `Could not save: ${e.message}`; }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(toApi(), null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `${state.title.replace(/[^\w-]+/g, "_") || "trivia"}.json` });
  document.body.append(a); a.click(); a.remove();
}
async function importFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try { load(JSON.parse(await file.text())); } catch { $("#err").textContent = "That file is not valid trivia JSON."; }
}
async function loadSample() { load(await (await fetch("/starter.json")).json()); }

render();
