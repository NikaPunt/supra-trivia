import { $, api, h, hostHeader, mount } from "./common.js";
await hostHeader($("#bar"));

const id = new URLSearchParams(location.search).get("id");
const mods = await api("/api/modules");
const byType = Object.fromEntries(mods.map((m) => [m.type, m]));

let state = { title: "My trivia", settings: { maxGuesses: 3, timeLimit: 180 }, rounds: [{ title: "Round 1", modules: [] }] };
if (id) state = await api(`/api/trivias/${id}`);
state.settings ??= { maxGuesses: 3 };
state.settings.timeLimit ??= 180;

// The editor keeps friendly shapes (lists as arrays of raw lines, numbers as typed); toApi() cleans them for the server.
const defaultFor = (f) => (f.kind === "list" || f.kind === "numlist" ? (Array.isArray(f.default) ? [...f.default] : [""]) : (f.default ?? ""));
/** A new question starts in the same section as the one before it, so a run of Hodgepodge needs typing once. */
const blank = (type, previous) => {
  const config = Object.fromEntries(byType[type].fields.map((f) => [f.key, defaultFor(f)]));
  // A new confidence question joins the last confidence set by default, with its values, so a set is never started by accident.
  const last = type === "confidence" ? confidenceBlocks().at(-1) : null;
  if (last) { config.poolId = last.config.poolId; config.poolValues = [...(last.config.poolValues ?? [])]; }
  return { type, open: true, section: previous?.section, maxGuesses: undefined, timeLimit: undefined, config };
};

// ---- confidence sets: chosen from a list, with values entered once ----
const poolKey = (name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const confidenceBlocks = () => state.rounds.flatMap((r) => r.modules).filter((m) => m.type === "confidence");
const poolMembers = (name) => confidenceBlocks().filter((m) => poolKey(m.config.poolId) === poolKey(name));
const poolNames = () => {
  const seen = new Map();
  for (const m of confidenceBlocks()) { const k = poolKey(m.config.poolId); if (k && !seen.has(k)) seen.set(k, String(m.config.poolId).trim().replace(/\s+/g, " ")); }
  return [...seen.values()];
};
const poolValueCount = (m) => (m.config.poolValues ?? []).map((v) => (typeof v === "number" ? v : String(v).trim() === "" ? NaN : Number(v))).filter(Number.isFinite).length;

function poolWarnings(m) {
  const q = poolMembers(m.config.poolId).length, v = poolValueCount(m);
  if (!poolKey(m.config.poolId)) return ["Give this set a name."];
  const out = [];
  if (q === 1) out.push("This set has only one question, so there is nothing to choose between.");
  if (q > v) out.push(`This set has ${q} questions but only ${v} value${v === 1 ? "" : "s"}, so the last ${q - v} cannot bet anything.`);
  if (v > q && q > 1) out.push(`This set has ${v} values but only ${q} questions, so ${v - q} value${v - q === 1 ? "" : "s"} will go unused.`);
  return out;
}

function poolPicker(m) {
  const names = poolNames();
  const key = poolKey(m.config.poolId);
  const naming = m._newPool || !key;
  const join = (name) => {
    const other = poolMembers(name).find((x) => x !== m);
    m._newPool = false; m.config.poolId = name;
    if (other) m.config.poolValues = [...other.config.poolValues];
    render();
  };
  const select = h("select", { "aria-label": "Confidence set", onchange: (e) => {
    if (e.target.value === "__new") { m._newPool = true; m.config.poolId = ""; render(); } else join(e.target.value);
  } },
    names.map((n) => h("option", { value: n, selected: !naming && poolKey(n) === key }, `${n} (${poolMembers(n).length} question${poolMembers(n).length === 1 ? "" : "s"})`)),
    h("option", { value: "__new", selected: naming }, "New set…"));
  const text = naming ? h("input", { type: "text", maxlength: 30, placeholder: "e.g., Confidence Set 2", value: m.config.poolId ?? "", "aria-label": "New set name",
    onchange: (e) => { const v = e.target.value.trim().replace(/\s+/g, " "); if (!v) return; const hit = names.find((n) => poolKey(n) === poolKey(v)); join(hit ?? v); } }) : null;
  return h("div", {}, h("label", {}, "Confidence set (questions in the same set share one list of values, each spent once)"), select, text,
    naming ? null : poolWarnings(m).map((w) => h("p", { class: "warnline" }, w)));
}

function poolValuesRow(m, f) {
  const others = poolMembers(m.config.poolId).filter((x) => x !== m).length;
  const area = h("textarea", { rows: 3, value: (m.config.poolValues ?? []).join("\n"), placeholder: "8\n6\n4\n2",
    oninput: (e) => { m.config.poolValues = e.target.value.split("\n"); for (const x of poolMembers(m.config.poolId)) if (x !== m) x.config.poolValues = [...m.config.poolValues]; },
    onchange: () => render() });
  return h("div", {}, h("label", {}, `${f.label} (one per line)`), area,
    h("p", { class: "muted" }, others ? `Shared with the other ${others} question${others === 1 ? "" : "s"} in this set: changing them here changes them everywhere in the set.` : "Only this question uses this set so far."));
}

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
    settings: { maxGuesses: Number(s.maxGuesses), timeLimit: Number(s.timeLimit ?? 180), ...(s.theme && s.theme.secret?.trim() ? { theme: { secret: s.theme.secret.trim(), hint: s.theme.hint ?? "", formal: s.theme.formal ?? "", bonus: Number(s.theme.bonus ?? 4) } } : {}) },
    rounds: state.rounds.map((r) => ({
      title: r.title,
      modules: r.modules.map((m) => ({
        type: m.type,
        ...(m.section?.trim() ? { section: m.section.trim() } : {}),
        ...(m.maxGuesses === undefined || m.maxGuesses === "" ? {} : { maxGuesses: Number(m.maxGuesses) }),
        ...(m.timeLimit === undefined || m.timeLimit === "" ? {} : { timeLimit: Number(m.timeLimit) }),
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
  const list = state.rounds[toRound].modules;
  let mod;
  if (drag.from === "palette") mod = blank(drag.type, list[(toIndex ?? list.length) - 1]);
  else { mod = state.rounds[drag.r].modules.splice(drag.i, 1)[0]; if (drag.r === toRound && toIndex !== undefined && drag.i < toIndex) toIndex--; }
  list.splice(toIndex ?? list.length, 0, mod);
  drag = null; render();
}

function fieldInput(m, f) {
  const v = m.config[f.key];
  const on = (fn) => (e) => { m.config[f.key] = fn(e.target.value); };
  const ph = f.placeholder ?? undefined;
  if (f.kind === "textarea") return h("textarea", { rows: 5, value: v ?? "", placeholder: ph, oninput: on((x) => x) });
  if (f.kind === "list" || f.kind === "numlist") return h("textarea", { rows: 3, value: (v ?? []).join("\n"), placeholder: ph, oninput: on((x) => x.split("\n")) });
  if (f.kind === "index") return h("input", { type: "number", min: 1, value: Number(v) + 1, oninput: on((x) => Number(x) - 1) });
  if (f.kind === "number") return h("input", { type: "number", step: "any", value: v ?? "", oninput: on((x) => x) });
  if (f.kind === "select") return h("select", { onchange: on((x) => x) }, h("option", { value: "" }, "(not set)"), f.options.map((o) => h("option", { value: o, selected: o === v }, o)));
  return h("input", { type: "text", value: v ?? "", placeholder: ph, oninput: on((x) => x) });
}

/** With "wager capped by team score" on, a question's own maximum wager is not used, so its box is greyed out. */
const fieldRow = (m, f) => {
  if (m.type === "confidence" && f.key === "poolId") return poolPicker(m);
  if (m.type === "confidence" && f.key === "poolValues") return poolValuesRow(m, f);
  if (f.kind === "checkbox") {
    return h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!m.config[f.key], onchange: (e) => { m.config[f.key] = e.target.checked; render(); } }),
      ` ${f.label}`, f.help ? h("small", { class: "muted" }, ` (${f.help})`) : null);
  }
  const off = f.key === "maxWager" && !!m.config.capByScore;
  const input = fieldInput(m, f);
  if (off) input.disabled = true;
  return h("div", { class: off ? "off" : "" }, h("label", {}, f.label + (f.help ? ` (${f.help})` : "")), input,
    off ? h("p", { class: "muted" }, "Not used: this wager is capped by each team's score.") : null);
};

const describeGuesses = (n) => (n === 0 ? "unlimited guesses" : `${n} guess${n === 1 ? "" : "es"}`);
const describeTime = (n) => (n === 0 ? "no timer" : n >= 60 ? `${n} seconds (${+(n / 60).toFixed(1)} minutes)` : `${n} seconds`);

/**
 * A per-question setting that starts filled in with the trivia's own default and says so. Typing the default back in
 * simply means "use the default", so the question keeps following it if the default changes later.
 */
function defaulted(m, key, def, { label, min, max, describe }) {
  const note = h("p", { class: "muted" });
  const show = () => { note.textContent = m[key] === undefined ? `Defaulted to ${describe(def)}. Change it to give just this question its own.` : `Changed for this question. The trivia default is ${describe(def)}.`; };
  const input = h("input", { type: "number", min, max, value: m[key] ?? def, oninput: (e) => { const v = e.target.value; m[key] = v === "" || Number(v) === def ? undefined : Number(v); show(); } });
  input.addEventListener("change", () => { if (input.value === "") input.value = def; });
  show();
  return h("div", {}, h("label", {}, label), input, note);
}

function card(r, i, m) {
  const def = byType[m.type];
  const el = h("div", { class: "mod", draggable: "true" });
  el.addEventListener("dragstart", (e) => { drag = { from: "card", r, i }; e.dataTransfer.setData("text/plain", "m"); e.stopPropagation(); });
  el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); drop(r, i); });
  const move = (d) => () => { const a = state.rounds[r].modules; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; render(); };
  const toggle = () => { m.open = !m.open; render(); };
  const q = String(m.config.question ?? "").trim().split("\n")[0];
  const main = def.fields.filter((f) => !f.advanced);
  const more = def.fields.filter((f) => f.advanced);
  mount(el,
    h("div", { class: "head" }, h("strong", { class: "grow" }, `⠿ ${i + 1}. ${def.label}`),
      h("button", { onclick: toggle, "aria-expanded": m.open ? "true" : "false" }, m.open ? "Done" : "Edit"),
      h("button", { onclick: move(-1), "aria-label": "Move up" }, "↑"), h("button", { onclick: move(1), "aria-label": "Move down" }, "↓"),
      h("button", { class: "danger", onclick: () => { state.rounds[r].modules.splice(i, 1); render(); }, "aria-label": "Remove" }, "✕")),
    m.open ? [
      main.map((f) => fieldRow(m, f)),
      h("details", { class: "more" }, h("summary", {}, "More options"),
        h("div", {}, h("label", {}, "Section name (e.g., Hodgepodge, Vanna, Three Actors and a Year, etc.)"),
          h("input", { type: "text", maxlength: 60, value: m.section ?? "", placeholder: "Hodgepodge", oninput: (e) => { m.section = e.target.value; } })),
        more.map((f) => fieldRow(m, f)),
        defaulted(m, "maxGuesses", Number(state.settings.maxGuesses), { label: "Number of guesses allowed (0 = unlimited)", min: 0, max: 50, describe: describeGuesses }),
        defaulted(m, "timeLimit", Number(state.settings.timeLimit), { label: "Time limit in seconds (0 = no timer)", min: 0, max: 3600, describe: describeTime })),
    ] : h("div", { class: "sum", onclick: toggle }, h("span", {}, q || "(no question yet)"), m.section ? h("span", { class: "badge" }, m.section) : null));
  return el;
}

// ---- info cards: what a good question looks like ----
const TIPS = [
  "Write the question as one block of text, the way it will be read out. End with the ask on its own line, like \"Which Asian country is this?\"",
  "Aim for an answer most people recognise once they hear it, reached by connecting two ideas. If a tester says \"never heard of it\", change it.",
  "Give two angles in the text: a clever one for the enthusiasts, then a broader one so everyone has a foothold.",
  "Skip raw dates and numbers unless they can be worked out from what you give.",
  "Read it aloud. If you stumble, the room will. Put the question word at the start or the end.",
  "Under Answer, add other spellings or just the surname, one per line, so a right answer is never marked wrong.",
];
const EXAMPLES = [
  {
    type: "Question and answer",
    q: "Its national flag is the only one in the world that is not a four-sided rectangle. Located in the Himalayas, it is home to Mount Everest.\n\nWhich Asian country is this?",
    a: "Nepal",
    why: "A famous answer, two angles, and the last line says exactly what to type.",
  },
  {
    type: "Question and answer",
    q: "In the 1830s a doctor sold this table-top item in pill form as a cure for indigestion. A tomato-and-vinegar version later made it famous.\n\nWhat condiment is this?",
    a: "Ketchup\ncatsup",
    why: "A surprising story, a famous answer, and the other spelling is accepted.",
  },
  {
    type: "Multiple choice",
    q: "Which of these South American countries has no coastline?",
    a: "Peru, Bolivia, Chile, Ecuador. Correct: Bolivia",
    why: "Constrained options give the table something to debate.",
  },
  {
    type: "Closest number (a good tie-breaker)",
    q: "The year Hong Kong returned to China, Deep Blue beat Kasparov, and Titanic reached cinemas.\n\nWhat year was it?",
    a: "1997",
    why: "Players can work it out from the clues, so it is not just recall. The closest guess wins.",
  },
  {
    type: "Confidence set",
    q: "What is the capital of Australia?",
    a: "Canberra\nPool: 8, 6, 4, 2 across four questions",
    why: "Each player spends each value once, on the question they feel surest about.",
  },
  {
    type: "Final Jeopardy",
    q: "Category: Inventors\n\nBorn in Edinburgh in 1847, he was awarded the first US patent for the telephone in 1876.\n\nWho is he?",
    a: "Alexander Graham Bell\nBell",
    why: "Players see only the category and wager first; you show the question afterwards. The wager shows how sure a team is of the subject.",
  },
  {
    type: "Final wager (non-Jeopardy)",
    q: "He is the only person to have served as both US president and Chief Justice.\n\nWho is he?",
    a: "William Howard Taft\nTaft",
    why: "Players see the question and send an answer and a wager together, up to the maximum. Right wins it, wrong loses it.",
  },
];

function helpCards(total) {
  return [
    h("details", { class: "card help", open: total === 0 ? true : undefined },
      h("summary", {}, h("strong", {}, "What makes a good question")),
      h("ul", {}, TIPS.map((t) => h("li", {}, t))),
      h("p", { class: "muted" }, "The full guidelines are in docs/GUIDELINES.md in the project.")),
    h("details", { class: "card help", open: total === 0 ? true : undefined },
      h("summary", {}, h("strong", {}, "Examples of each type")),
      EXAMPLES.map((e) => h("div", { class: "example" },
        h("div", { class: "eyebrow" }, e.type),
        h("p", { class: "eq" }, e.q),
        h("p", { class: "ea" }, h("strong", {}, "Answer: "), e.a),
        h("p", { class: "muted" }, e.why)))),
  ];
}

function themeCard() {
  const s = state.settings;
  const on = !!s.theme;
  return h("div", { class: "card theme-card" }, h("h2", {}, "Overall theme"),
    h("label", {}, h("input", { type: "checkbox", style: "width:auto", checked: on, onchange: (e) => { s.theme = e.target.checked ? { secret: "", hint: "", formal: "", bonus: 4 } : undefined; render(); } }), " This trivia has a secret theme that links the questions"),
    on ? h("div", {},
      h("label", {}, "The theme (short, for you to grade guesses)"), h("input", { value: s.theme.secret, maxlength: 200, oninput: (e) => { s.theme.secret = e.target.value; } }),
      h("label", {}, "Hint players see"), h("input", { value: s.theme.hint ?? "", maxlength: 300, oninput: (e) => { s.theme.hint = e.target.value; } }),
      h("label", {}, "Explanation shown when the theme is revealed"), h("textarea", { rows: 3, maxlength: 600, oninput: (e) => { s.theme.formal = e.target.value; } }, s.theme.formal ?? ""),
      h("label", {}, "Points for finding it at question 1 (one less for each question after, never below 1)"),
      h("input", { type: "number", min: 0.5, max: 100, step: 0.5, value: s.theme.bonus ?? 4, oninput: (e) => { s.theme.bonus = e.target.value; } }),
      h("p", { class: "muted" }, "Players can guess it once the game starts and you approve guesses. It goes public when round two begins, when every player has found it, or when you reveal it.")) : null);
}

function render() {
  const total = state.rounds.reduce((a, r) => a + r.modules.length, 0);
  mount($("#app"),
    h("div", { class: "row" }, h("input", { class: "grow", value: state.title, maxlength: 120, "aria-label": "Trivia title", oninput: (e) => { state.title = e.target.value; } }),
      h("button", { class: "primary", onclick: save }, "Save"), h("a", { class: "btn", href: "/host.html" }, "Back")),
    h("p", { class: "err", id: "err" }),
    h("div", { class: "row" },
      h("span", { class: total > 50 ? "warnline" : "muted" }, `${total} question${total === 1 ? "" : "s"}${total > 50 ? ": over 50 tires players out" : ""}`),
      h("span", { class: "grow" }),
      h("button", { onclick: exportJson }, "Export JSON"), h("button", { onclick: () => $("#file").click() }, "Import JSON"),
      !id && !total ? h("button", { onclick: loadSample }, "Load sample trivia") : null,
      h("input", { id: "file", type: "file", accept: "application/json,.json", style: "display:none", onchange: importFile })),
    helpCards(total),
    h("div", { class: "card" }, h("label", { for: "mg" }, "Guesses each player gets per question (0 = unlimited)"),
      h("input", { id: "mg", type: "number", min: 0, max: 50, value: state.settings.maxGuesses, oninput: (e) => { state.settings.maxGuesses = e.target.value; }, onchange: (e) => { if (e.target.value === "") state.settings.maxGuesses = 3; render(); } }),
      h("p", { class: "muted" }, "Players never see whether a guess was right until you reveal. You can always award points by hand, including half marks."),
      h("label", { for: "tl" }, "Time per question in seconds (0 = no timer)"),
      h("input", { id: "tl", type: "number", min: 0, max: 3600, step: 5, value: state.settings.timeLimit, oninput: (e) => { state.settings.timeLimit = e.target.value; }, onchange: (e) => { if (e.target.value === "") state.settings.timeLimit = 180; render(); } }),
      h("p", { class: "muted" }, "Answers close by themselves when time runs out: 180 is 3 minutes. You can close sooner, add time while a question is open, or give one question its own time under More options."),
      ),
    themeCard(),
    h("div", { class: "builder" },
      h("aside", { class: "palette card" }, h("h2", {}, "Question types"), h("p", { class: "muted" }, "Drag onto a round, or click to add to the last round."),
        mods.map((m) => { const c = h("div", { class: "chip", draggable: "true", title: m.description, onclick: () => { const l = state.rounds.at(-1).modules; l.push(blank(m.type, l.at(-1))); render(); } }, m.label, h("small", {}, m.description));
          c.addEventListener("dragstart", (e) => { drag = { from: "palette", type: m.type }; e.dataTransfer.setData("text/plain", "p"); }); return c; })),
      h("section", {}, state.rounds.map((r, ri) => {
        const zone = h("div", { class: "dropzone" });
        zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("over"));
        zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); drop(ri); });
        mount(zone, r.modules.map((m, i) => card(ri, i, m)), r.modules.length ? null : h("p", { class: "muted" }, "Drop question types here"));
        return h("div", { class: "round" },
          h("div", { class: "row" }, h("input", { class: "grow", value: r.title, maxlength: 100, "aria-label": "Round title", oninput: (e) => { r.title = e.target.value; } }),
            state.rounds.length > 1 ? h("button", { class: "danger", onclick: () => { state.rounds.splice(ri, 1); render(); } }, "Remove round") : null), zone);
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
