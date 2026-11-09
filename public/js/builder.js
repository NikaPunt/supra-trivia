import { $, api, deviceId, h, hostHeader, mount } from "./common.js";
const me = await hostHeader($("#bar"));

const id = new URLSearchParams(location.search).get("id");
const mods = await api("/api/modules");
const byType = Object.fromEntries(mods.map((m) => [m.type, m]));

let state = { title: "My trivia", settings: { maxGuesses: 3, timeLimit: 180 }, rounds: [{ title: "Round 1", modules: [] }] };
let savedAt = 0; // when the server's copy was last saved; a draft built on an older copy is out of date
if (id) { state = await api(`/api/trivias/${id}`); savedAt = state.updated_at ?? 0; }
state.settings ??= { maxGuesses: 3 };
state.settings.timeLimit ??= 180;

// ---- draft cache ----
// Unsaved work is copied to this browser at once and to the server a few seconds later, so it survives a reload, a crash, or
// opening the trivia on another device. It is only ever a draft: the saved trivia changes when the host hits Save, and Save clears the draft.
// A brand-new trivia has no id on the server yet, so its draft stays in this browser only.
// Drafts are never dropped for being big. If one cannot be stored somewhere, the page says so, so the host can Save or Export JSON.
const DRAFT_KEY = `trivia-draft:${me?.email ?? "?"}:${id ?? "new"}`; // per person, so a shared browser never offers one host's work to another
const snap = () => JSON.stringify({ title: state.title, settings: state.settings, rounds: state.rounds }); // editable parts only
let baseline = snap();   // what the server (or a fresh page) has
let pendingDraft = null; // an unsaved draft found on load, waiting for restore/discard
let serverDraft = false; // whether the server is holding a draft of ours
const readDraft = () => { try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY)); return d && typeof d.state === "string" ? d : null; } catch { return null; } };
const clearLocal = () => { try { localStorage.removeItem(DRAFT_KEY); } catch {} };
let draftTimer, serverTimer, inflight = Promise.resolve(), localFailed = false, serverFailed = "";
const note = () => {
  const el = $("#draftnote"); if (!el) return;
  const msgs = [];
  if (localFailed) msgs.push("This browser has no room to keep a draft");
  if (serverFailed) msgs.push(serverFailed);
  if (msgs.length) { el.className = "warnline"; el.textContent = `${msgs.join(". ")}. Save, or Export JSON, so you don't lose your work.`; }
  else { el.className = "muted"; el.textContent = lastBackup ? `Draft backed up at ${lastBackup}` : ""; }
};
let lastBackup = "";
const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const saveLocal = () => { // base says which saved copy the draft grew from, so a draft is judged by the server's clock, not this device's
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), base: savedAt, state: snap() })); localFailed = false; } catch { localFailed = true; }
  note();
};

function pushServer() {
  if (!id || pendingDraft) return inflight;
  const now = snap();
  const job = now === baseline
    ? (serverDraft ? api(`/api/trivias/${id}/draft`, { method: "DELETE" }).then(() => { serverDraft = false; }) : Promise.resolve())
    : api(`/api/trivias/${id}/draft`, { method: "PUT", body: { state: now } }).then(() => { serverDraft = true; serverFailed = ""; lastBackup = clock(); });
  return (inflight = inflight.then(() => job).catch((e) => { serverFailed = e.status === 413 || e.status === 400 ? "This draft is too big to back up to the server" : "Could not back up the draft to the server"; }).then(note));
}
async function clearDraft() { // used by Discard: drops the draft everywhere
  clearTimeout(draftTimer); clearTimeout(serverTimer); clearLocal();
  await inflight;
  if (id) { try { await api(`/api/trivias/${id}/draft`, { method: "DELETE" }); } catch {} serverDraft = false; }
}
function cacheDraft() {
  clearTimeout(draftTimer); clearTimeout(serverTimer);
  if (pendingDraft) return; // do not overwrite the found draft until the host decides
  draftTimer = setTimeout(() => { if (snap() === baseline) { clearLocal(); localFailed = false; note(); } else saveLocal(); }, 800);
  serverTimer = setTimeout(pushServer, 3000);
}
{ // On load, offer back the newest unsaved draft, whether it was cached here or on the server (say, from another device).
  let local = readDraft();
  // A browser draft grown from an older saved copy than the server has now (it was saved from somewhere else since) would overwrite newer work, so it is dropped.
  if (local && id && (local.base !== undefined ? local.base < savedAt : local.at < savedAt)) { clearLocal(); local = null; }
  let remote = null;
  if (id) { try { remote = (await api(`/api/trivias/${id}/draft`)).draft; serverDraft = !!remote; } catch {} }
  const newest = [local, remote].filter(Boolean).sort((x, y) => y.at - x.at)[0];
  if (newest && newest.state !== baseline) pendingDraft = newest;
  else { clearLocal(); if (remote) pushServer(); }
}

// The editor keeps friendly shapes (lists as arrays of raw lines, numbers as typed); toApi() cleans them for the server.
const defaultFor = (f) => (f.kind === "list" || f.kind === "numlist" ? (Array.isArray(f.default) ? [...f.default] : [""]) : (f.default ?? ""));
/** A new question starts in the same section as the one before it, so a run of Hodgepodge needs typing once. */
const blank = (type, previous) => {
  const config = Object.fromEntries(byType[type].fields.map((f) => [f.key, defaultFor(f)]));
  // A confidence question continues the confidence set before it, or starts one called "Confidence Set".
  const section = type === "confidence" ? (previous?.type === "confidence" && previous.section ? previous.section : "Confidence Set") : previous?.section;
  return { type, open: true, section, maxGuesses: undefined, timeLimit: undefined, config };
};

// ---- sections, and confidence sets (a confidence set is a run of confidence questions with the same section) ----
const canon = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const secKey = (s) => canon(s).toLowerCase();
/** Looser than secKey: also ignores punctuation and a trailing "s", to spot "Confidence Sets" next to "Confidence Set". */
const nearKey = (s) => secKey(s).replace(/[^\p{L}\p{N}]/gu, "").replace(/s$/, "");
const allMods = () => state.rounds.flatMap((r) => r.modules);
const runKey = (m) => (m.type === "confidence" ? "C:" : "S:") + secKey(m.section);

/** Each section name used anywhere in the trivia, once, as first spelled. */
function sectionNames() {
  const seen = new Map();
  for (const m of allMods()) { const k = secKey(m.section); if (k && !seen.has(k)) seen.set(k, canon(m.section)); }
  return [...seen.values()];
}
/** Groups of section names that differ only by capitals, punctuation or a trailing "s". */
function nearDuplicates() {
  const by = new Map();
  for (const n of sectionNames()) { const k = nearKey(n); if (k) by.set(k, [...(by.get(k) ?? []), n]); }
  return [...by.values()].filter((g) => g.length > 1);
}
/** Runs of neighbouring questions in a round that share a section (and, for confidence, are all confidence questions). */
function runsOf(list) {
  const runs = [];
  list.forEach((m, i) => { const last = runs.at(-1); if (last && runKey(list[last.start]) === runKey(m)) last.end = i; else runs.push({ start: i, end: i }); });
  return runs;
}
const valueCount = (m) => (m.config.poolValues ?? []).map((v) => (typeof v === "number" ? v : String(v).trim() === "" ? NaN : Number(v))).filter(Number.isFinite).length;
/** Where a block sits in its run: how many questions the run has and whether this is the first, which owns the values. */
function runInfo(m) {
  const list = state.rounds.find((r) => r.modules.includes(m))?.modules ?? [m];
  const run = runsOf(list).find((x) => list.indexOf(m) >= x.start && list.indexOf(m) <= x.end);
  const i = list.indexOf(m);
  return { n: run.end - run.start + 1, first: i === run.start, head: list[run.start] };
}
/** Every question in a confidence set offers the first question's values, so the values are typed once. */
function syncRuns() {
  for (const r of state.rounds) for (const run of runsOf(r.modules)) {
    const head = r.modules[run.start];
    if (head.type !== "confidence") continue;
    for (let i = run.start + 1; i <= run.end; i++) r.modules[i].config.poolValues = [...(head.config.poolValues ?? [])];
  }
}
function runWarnings(head, n) {
  const v = valueCount(head), out = [];
  if (n === 1) out.push("This set has only one question, so there is nothing to choose between.");
  if (n > v) out.push(`This set has ${n} questions but only ${v} value${v === 1 ? "" : "s"}, so the last ${n - v} cannot bet anything.`);
  if (v > n && n > 1) out.push(`This set has ${v} values but only ${n} questions, so ${v - n} value${v - n === 1 ? "" : "s"} will go unused.`);
  return out;
}

function sectionPicker(m, label) {
  const names = sectionNames(), key = secKey(m.section), naming = !!m._newSection;
  const pick = (name) => { m._newSection = false; m.section = name || undefined; render(); };
  const select = h("select", { "aria-label": "Section", onchange: (e) => { if (e.target.value === "__new") { m._newSection = true; render(); } else pick(e.target.value); } },
    h("option", { value: "", selected: !naming && !key }, "(no section)"),
    names.map((n) => h("option", { value: n, selected: !naming && secKey(n) === key }, n)),
    h("option", { value: "__new", selected: naming }, "New section…"));
  const text = naming ? h("input", { type: "text", maxlength: 60, placeholder: "Hodgepodge", "aria-label": "New section name",
    onchange: (e) => { const v = canon(e.target.value); if (!v) return; pick(names.find((n) => secKey(n) === secKey(v)) ?? v); } }) : null;
  return h("div", {}, h("label", {}, label), select, text);
}

function poolValuesRow(m, f) {
  const { n, first, head } = runInfo(m);
  if (!first) return h("div", {}, h("label", {}, f.label), h("p", { class: "muted" }, `Same as the first question in this set: ${(head.config.poolValues ?? []).join(", ")}. Change them there.`));
  const area = h("textarea", { rows: 3, value: (m.config.poolValues ?? []).join("\n"), placeholder: "8\n6\n4\n2",
    oninput: (e) => { m.config.poolValues = e.target.value.split("\n"); }, onchange: () => render() });
  return h("div", {}, h("label", {}, `${f.label} (one per line)`), area,
    h("p", { class: "muted" }, n > 1 ? `Shared with the other ${n - 1} question${n === 2 ? "" : "s"} in this set.` : "Only this question is in this set so far. Add confidence questions straight after it, with the same section, to extend it."));
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
  drag = null; // Typing mutates state without re-rendering, so listen for edits on the page itself.
$("#app").addEventListener("input", cacheDraft);
$("#app").addEventListener("change", cacheDraft);
window.addEventListener("pagehide", () => { clearTimeout(draftTimer); if (!pendingDraft) try { if (snap() !== baseline) localStorage.setItem(DRAFT_KEY, JSON.stringify({ at: Date.now(), state: snap() })); } catch {} });
window.addEventListener("beforeunload", (e) => { if (snap() !== baseline) { e.preventDefault(); e.returnValue = ""; } });

render();
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
  const { n, first, head } = runInfo(m);
  const isConf = m.type === "confidence";
  const inRun = n > 1 && (isConf || !!secKey(m.section));
  if (inRun) el.classList.add("inrun");
  const bar = first && (isConf || inRun)
    ? h("div", { class: "runbar" }, h("strong", {}, isConf ? `Confidence set${secKey(m.section) ? ` · ${canon(m.section)}` : ""}` : canon(m.section)),
        h("span", { class: "muted" }, `${n} question${n === 1 ? "" : "s"}${isConf ? ` · values ${(m.config.poolValues ?? []).join(", ")}` : ""}`),
        isConf ? runWarnings(head, n).map((w) => h("p", { class: "warnline" }, w)) : null)
    : null;
  mount(el, bar,
    h("div", { class: "head" }, h("strong", { class: "grow" }, `⠿ ${i + 1}. ${def.label}`),
      h("button", { onclick: toggle, "aria-expanded": m.open ? "true" : "false" }, m.open ? "Done" : "Edit"),
      h("button", { onclick: move(-1), "aria-label": "Move up" }, "↑"), h("button", { onclick: move(1), "aria-label": "Move down" }, "↓"),
      h("button", { class: "danger", onclick: () => { state.rounds[r].modules.splice(i, 1); render(); }, "aria-label": "Remove" }, "✕")),
    m.open ? [
      m.type === "confidence" ? sectionPicker(m, "Confidence set: the section name (questions in a row with the same section share one list of values, each spent once)") : null,
      main.map((f) => fieldRow(m, f)),
      h("details", { class: "more" }, h("summary", {}, "More options"),
        m.type === "confidence" ? null : sectionPicker(m, "Section name (e.g., Hodgepodge, Vanna, Three Actors and a Year, etc.)"),
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
      h("label", {}, "Points for finding it (the same for every team, however early)"),
      h("input", { type: "number", min: 0.5, max: 100, step: 0.5, value: s.theme.bonus ?? 4, oninput: (e) => { s.theme.bonus = e.target.value; } }),
      h("p", { class: "muted" }, "Players can guess it once the game starts and you approve guesses. It goes public when round two begins, when every player has found it, or when you reveal it.")) : null);
}

/** Section names that look like typos of each other, with a button to make them all one spelling. */
function typoCard() {
  const groups = nearDuplicates();
  if (!groups.length) return null;
  const unify = (names, to) => { for (const m of allMods()) if (names.some((n) => secKey(n) === secKey(m.section))) m.section = to; render(); };
  return h("div", { class: "card typo" }, h("strong", {}, "These section names look like the same one"),
    groups.map((g) => h("div", { class: "row" }, h("span", { class: "grow" }, g.map((n) => `“${n}”`).join(" and ")),
      g.map((n) => h("button", { onclick: () => unify(g, n) }, `Use “${n}” everywhere`)))));
}

function draftBanner() {
  if (!pendingDraft) return null;
  const d = pendingDraft;
  return h("div", { class: "card typo" }, h("strong", {}, `You have unsaved changes from ${new Date(d.at).toLocaleString()}`),
    h("p", { class: "muted" }, "They were backed up as a draft but never saved to the trivia itself."),
    h("div", { class: "row" },
      h("button", { class: "primary", onclick: () => { state = JSON.parse(d.state); pendingDraft = null; render(); cacheDraft(); } }, "Restore them"),
      h("button", { onclick: () => { pendingDraft = null; clearDraft(); render(); } }, "Discard")));
}

function render() {
  syncRuns();
  cacheDraft();
  const total = state.rounds.reduce((a, r) => a + r.modules.length, 0);
  mount($("#app"),
    draftBanner(),
    h("div", { class: "row" }, h("input", { class: "grow", value: state.title, maxlength: 120, "aria-label": "Trivia title", oninput: (e) => { state.title = e.target.value; } }),
      h("button", { class: "primary", onclick: save }, "Save"), h("a", { class: "btn", href: "/host.html" }, "Back")),
    h("p", { class: "err", id: "err" }),
    id ? h("p", { class: "muted", id: "draftnote" }) : null,
    h("div", { class: "row" },
      h("span", { class: total > 50 ? "warnline" : "muted" }, `${total} question${total === 1 ? "" : "s"}${total > 50 ? ": over 50 tires players out" : ""}`),
      h("span", { class: "grow" }),
      h("button", { onclick: exportJson }, "Export JSON"), h("button", { onclick: () => $("#file").click() }, "Import JSON"),
      !id && !total ? h("button", { onclick: loadSample }, "Load sample trivia") : null,
      h("input", { id: "file", type: "file", accept: "application/json,.json", style: "display:none", onchange: importFile })),
    helpCards(total),
    typoCard(),
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
  clearTimeout(draftTimer); clearTimeout(serverTimer);
  await inflight; // a draft upload still on its way must not land after the save
  try {
    if (id) await api(`/api/trivias/${id}`, { method: "PUT", body: toApi() });
    else { const r = await api("/api/trivias", { method: "POST", body: toApi() }); baseline = snap(); clearLocal(); location.href = `/builder.html?id=${r.id}`; return; }
    baseline = snap(); clearLocal(); serverDraft = false; localFailed = false; serverFailed = ""; lastBackup = ""; note();
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

// Typing mutates state without re-rendering, so listen for edits on the page itself.
$("#app").addEventListener("input", cacheDraft);
$("#app").addEventListener("change", cacheDraft);
window.addEventListener("pagehide", () => {
  clearTimeout(draftTimer); clearTimeout(serverTimer);
  if (pendingDraft || snap() === baseline) return;
  saveLocal(); // synchronous, so it finishes even as the page closes, whatever the size
  // keepalive lets the request finish after the page is gone; browsers cap such bodies at about 64 KB, so a bigger draft relies on the browser copy and on the upload made when the tab was hidden
  const body = JSON.stringify({ state: snap() });
  if (id && body.length < 60000) fetch(`/api/trivias/${id}/draft`, { method: "PUT", keepalive: true, credentials: "same-origin", headers: { "content-type": "application/json", "x-device": deviceId() }, body }).catch(() => {});
});
// Switching tabs or locking the phone is the last reliable moment to upload a draft of any size.
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && !pendingDraft && snap() !== baseline) { clearTimeout(serverTimer); saveLocal(); pushServer(); } });
window.addEventListener("beforeunload", (e) => { if (snap() !== baseline) { e.preventDefault(); e.returnValue = ""; } });

render();
