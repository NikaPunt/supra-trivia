import { $, api, clock as countdown, deviceId, h, hostHeader, mount, questionBlock } from "./common.js";
import { alsoAccept, formatMinutes, isBlank, maxPoints, readiness, roundSummary } from "./ready.js";
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
const UI_ONLY = new Set(["open", "_newSection", "_preview"]); // how the page is showing a question, not part of the trivia
const snap = () => JSON.stringify({ title: state.title, settings: state.settings, rounds: state.rounds }, (k, v) => (UI_ONLY.has(k) ? undefined : v)); // editable parts only
const dirty = () => snap() !== baseline;
/** The "unsaved changes" mark in the save bar, kept current while typing without redrawing the page. */
function dirtyMark() {
  const el = $("#dirty"); if (!el) return;
  const d = dirty();
  el.className = d ? "dirty on" : "dirty";
  el.textContent = d ? "You have unsaved changes." : id ? "All changes are saved." : "This trivia is not saved yet.";
}
let baseline = snap();   // what the server (or a fresh page) has
let saveProblems = []; // what the server said was wrong with the last save, shown on the page and on the questions it is about
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
  dirtyMark();
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
  const section = type === "confidence" ? (previous?.type === "confidence" && previous.section ? previous.section : "Confidence Set")
    : previous?.type === "confidence" ? undefined : previous?.section; // a new question of another type never lands in a confidence set's section
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

function sectionPicker(m, label, help) {
  const names = sectionNames(), key = secKey(m.section), naming = !!m._newSection;
  const pick = (name) => { m._newSection = false; m.section = name || undefined; render(); };
  const select = h("select", { "aria-label": "Section", onchange: (e) => { if (e.target.value === "__new") { m._newSection = true; render(); } else pick(e.target.value); } },
    h("option", { value: "", selected: !naming && !key }, "(no section)"),
    names.map((n) => h("option", { value: n, selected: !naming && secKey(n) === key }, n)),
    h("option", { value: "__new", selected: naming }, "New section…"));
  const text = naming ? h("input", { type: "text", maxlength: 60, placeholder: "Hodgepodge", "aria-label": "New section name",
    onchange: (e) => { const v = canon(e.target.value); if (!v) return; pick(names.find((n) => secKey(n) === secKey(v)) ?? v); } }) : null;
  return h("div", {}, labelled(label, help), select, text);
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
  drag = null;
  render();
}

// ---- labels: a short label, who sees the box, and an ⓘ that opens the longer help (a tap works on phones, where hover does not) ----

/** Who sees each box, so nobody is surprised by what shows on the phones and the TV. */
const SEEN = {
  question: "Players see this on their phones and on the TV.",
  category: "Players see the category first, before they wager.",
  options: "Players see these options in this order.",
  count: "Players get this many boxes to fill in.",
  catchall: "Players see one extra box below the others.",
  answers: "Only you see these until you reveal the answer.",
  correct: "Only you know which one is right until you reveal the answer.",
  value: "Only you see this until you reveal the answer.",
  funFact: "Players see this when you reveal the answer.",
  maxWager: "Players see this maximum when they wager.",
};

/** A label with an ⓘ that shows the help, and who sees the box, in sentences underneath. Returns [labelRow, helpLine]. */
function labelled(label, help, seen, forId) {
  help = [help, seen].filter(Boolean).join(" ");
  const hint = help ? h("p", { class: "hint", hidden: true }, help) : null;
  const info = help ? h("button", { type: "button", class: "info", title: help, "aria-label": `About: ${label}`, "aria-expanded": "false",
    onclick: (e) => { hint.hidden = !hint.hidden; e.currentTarget.setAttribute("aria-expanded", String(!hint.hidden)); } }, "i") : null;
  return [h("div", { class: "lbl" }, h("label", forId ? { for: forId } : {}, label), info), hint];
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

/** Typed answers are matched against this list; these types get "Also accept" suggestions and the Try box. */
const TYPED = new Set(["text_qa", "confidence", "wager", "jeopardy"]);
const optionLines = (m) => (m.config.options ?? []).map((x) => String(x).trim()).filter(Boolean);

/** Multiple choice: pick the right option by clicking it, instead of typing its number. Redrawn in place as the options are typed. */
function correctPicker(m) {
  const box = h("div", { class: "radios", role: "radiogroup", "aria-label": "Correct option" });
  const draw = () => {
    const opts = optionLines(m);
    if (!(Number(m.config.correct) < opts.length)) m.config.correct = 0;
    mount(box, opts.length ? opts.map((o, i) => h("label", { class: "check" },
      h("input", { type: "radio", name: `correct-${uid(m)}`, checked: Number(m.config.correct) === i, onchange: () => { m.config.correct = i; cacheDraft(); } }), ` ${o}`))
      : h("p", { class: "muted" }, "Type the options above first."));
  };
  draw();
  box.redraw = draw;
  return box;
}

/** Other spellings worth accepting, as one-click buttons. Redrawn in place as answers are typed. */
function acceptChips(m) {
  const box = h("div", { class: "chips" });
  const draw = () => {
    const more = alsoAccept(m.config.answers);
    mount(box, more.length ? [h("span", { class: "muted" }, "A team might type the answer one of these ways, which would show as no match. Click one to accept it too: "), more.map((a) => h("button", { type: "button", class: "chipbtn",
      title: "A team could type it this way, and it would show as \"no match\"", onclick: () => {
        m.config.answers = [...(m.config.answers ?? []).filter((x) => String(x).trim()), a]; render();
      } }, `+ ${a}`))] : null);
  };
  draw();
  box.redraw = draw;
  return box;
}

const uids = new WeakMap();
let uidNext = 0;
const uid = (m) => (uids.has(m) ? uids.get(m) : (uids.set(m, ++uidNext), uidNext));

/** With "wager capped by team score" on, a question's own maximum wager is not used, so its box is greyed out. */
const fieldRow = (m, f, extras) => {
  if (m.type === "confidence" && f.key === "poolValues") return poolValuesRow(m, f);
  if (m.type === "multiple_choice" && f.key === "correct") return h("div", {}, labelled("Correct option", "Click the option that is the right answer.", SEEN.correct), extras.picker);
  if (f.kind === "checkbox") {
    const [, hint] = labelled(f.label, f.help ? f.help[0].toUpperCase() + f.help.slice(1) + "." : null, SEEN[f.key]);
    return h("div", {}, h("div", { class: "lbl" }, h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!(m.config[f.key] ?? f.default), onchange: (e) => { m.config[f.key] = e.target.checked; render(); } }),
      ` ${f.label}`), hint ? h("button", { type: "button", class: "info", title: hint.textContent, "aria-label": `About: ${f.label}`, onclick: () => { hint.hidden = !hint.hidden; } }, "i") : null), hint);
  }
  const off = f.key === "maxWager" && !!m.config.capByScore;
  const input = fieldInput(m, f);
  if (off) input.disabled = true;
  // Keep the bits that depend on this box current while typing, without redrawing (a redraw would take the cursor away).
  if (m.type === "multiple_choice" && f.key === "options") input.addEventListener("input", () => extras.picker.redraw());
  if (f.key === "answers" && extras.chips) input.addEventListener("input", () => extras.chips.redraw());
  return h("div", { class: off ? "off" : "" }, labelled(f.label + (f.kind === "list" ? " (one per line)" : ""), f.help ? f.help[0].toUpperCase() + f.help.slice(1) + "." : null, SEEN[f.key]), input,
    f.key === "answers" ? extras.chips : null,
    off ? h("p", { class: "muted" }, "This maximum is not used, because each team's wager is capped by its score.") : null);
};

// ---- try an answer: how the console would see a guess, using the server's own matching ----
function tryBox(m) {
  const nsome = m.type === "nsome";
  const out = h("p", { class: "muted", role: "status" });
  const field = h("input", { type: "text", maxlength: 600, placeholder: nsome ? "e.g. Paul, John, Ringo" : "Type a guess the way a team might",
    "aria-label": "Try an answer", onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } } });
  async function go() {
    const raw = field.value.trim();
    if (!raw) return;
    const value = nsome ? { items: raw.split(",").map((x) => x.trim()).filter(Boolean) } : { text: raw, bet: 1, wager: 1 };
    try {
      const r = await api("/api/modules/try", { method: "POST", body: { type: m.type, config: cleanConfig(byType[m.type], m.config), value } });
      if (r.error) { out.className = "warnline"; out.textContent = r.error; return; }
      const right = r.points > 0;
      out.className = right ? "okline" : "warnline";
      out.textContent = right
        ? (r.stake ? "The console would show this as looking right." : `The console would show this as looking right, worth ${r.points} of ${r.max} point${r.max === 1 ? "" : "s"}.`)
        : "The console would show this as no match, so you would have to mark it by hand. If it should count, add it to the accepted answers.";
    } catch (e) { out.className = "warnline"; out.textContent = e.message; }
  }
  return h("details", { class: "try" }, h("summary", {}, "Try an answer"),
    h("p", { class: "muted" }, nsome ? "Type a team's list, separated by commas, to see what it would score." : "See whether the console would flag a guess as \"looks right\". Capitals, accents and punctuation never matter."),
    h("div", { class: "row" }, h("span", { class: "grow" }, field), h("button", { type: "button", onclick: go }, "Try")), out);
}

// ---- preview: the question as a phone and the TV will show it ----
function publicOf(m) {
  const c = m.config;
  return { question: String(c.question ?? "").trim() || "(no question yet)", options: m.type === "multiple_choice" ? optionLines(m) : undefined,
    count: m.type === "nsome" ? Number(c.count || 3) : undefined, catchall: m.type === "nsome" ? !!c.catchall : undefined };
}
function previewBlock(r, i, m) {
  const round = state.rounds[r];
  const list = round.modules;
  let start = i, end = i;
  const key = secKey(m.section);
  if (key) { while (start > 0 && secKey(list[start - 1].section) === key) start--; while (end < list.length - 1 && secKey(list[end + 1].section) === key) end++; }
  const it = { round: round.title, section: canon(m.section) || undefined, pos: { n: i - start + 1, of: end - start + 1 }, public: publicOf(m) };
  const pub = it.public;
  const c = m.config;
  const time = Number(m.timeLimit ?? state.settings.timeLimit);
  /** The question block with the full time beside the round name, as it looks the moment the question opens. */
  const block = () => {
    const b = questionBlock(it, null);
    if (time > 0) b.querySelector(".where")?.append(h("span", { class: "clock" }, countdown(time * 1000)));
    return b;
  };
  const box = (label) => h("input", { type: "text", disabled: true, placeholder: label });
  let input;
  if (m.type === "multiple_choice") input = h("div", { class: "choices" }, pub.options.map((o) => h("button", { disabled: true }, o)));
  else if (m.type === "numeric_closest") input = box("A number");
  else if (m.type === "nsome") input = [h("p", { class: "muted" }, `List ${pub.count} things. You can leave one blank if you are not sure.`),
    Array.from({ length: Math.min(pub.count, 10) }, (_, k) => box(`Answer ${k + 1}`)), pub.catchall ? box("Anything else you are thinking of?") : null];
  else input = box("Your answer");
  const stake = m.type === "confidence" ? h("p", { class: "muted" }, `Plus a confidence value to spend: ${(c.poolValues ?? []).join(", ")}`)
    : m.type === "wager" ? h("p", { class: "muted" }, `Plus a wager from 0 to ${c.capByScore ? "their score" : c.maxWager || 20}`) : null;
  const jeopardy = m.type === "jeopardy" ? h("div", { class: "note" }, h("strong", {}, "First, before the question: "), `teams see only the category "${String(c.category ?? "").trim() || "(none yet)"}" and wager up to ${c.capByScore ? "their score" : c.maxWager || 20}. Then you press Show the question.`) : null;
  return h("div", { class: "preview" },
    jeopardy,
    h("div", { class: "frames" },
      h("figure", { class: "phonefig" }, h("figcaption", {}, "On a phone"), h("div", { class: "phone" }, block(), stake, input, h("button", { class: "primary", disabled: true }, "Lock in"))),
      h("figure", { class: "tvfig" }, h("figcaption", {}, "On the TV"), h("div", { class: "tvframe" }, h("div", { class: "tv" }, block(),
        pub.options ? h("ol", {}, pub.options.map((o) => h("li", {}, o))) : null,
        pub.count ? h("p", { class: "muted" }, `List ${pub.count} things${pub.catchall ? ", plus anything else you like" : ""}.`) : null,
        h("p", { class: "muted" }, "0/8 locked in"))), h("p", { class: "muted fitnote" }))),
    h("p", { class: "muted" }, "The real TV page shrinks a long question until it fits the screen. Answers and the fun fact appear only at the reveal."));
}

const describeGuesses = (n) => (n === 0 ? "unlimited guesses" : `${n} guess${n === 1 ? "" : "es"}`);
const describeTime = (n) => (n === 0 ? "no timer" : n >= 60 ? `${n} seconds (${+(n / 60).toFixed(1)} minutes)` : `${n} seconds`);

/**
 * A per-question setting that starts filled in with the trivia's own default and says so. Typing the default back in
 * simply means "use the default", so the question keeps following it if the default changes later.
 */
function defaulted(m, key, def, { label, help, min, max, describe }) {
  const note = h("p", { class: "muted" });
  const show = () => { note.textContent = m[key] === undefined ? `Defaulted to ${describe(def)}. Change it to give just this question its own.` : `Changed for this question. The trivia default is ${describe(def)}.`; };
  const input = h("input", { type: "number", min, max, value: m[key] ?? def, oninput: (e) => { const v = e.target.value; m[key] = v === "" || Number(v) === def ? undefined : Number(v); show(); } });
  input.addEventListener("change", () => { if (input.value === "") input.value = def; });
  show();
  return h("div", {}, labelled(label, help), input, note);
}

/** The little tags on a folded question: what it is worth, and any time or guess limit of its own. */
function badges(m) {
  const p = maxPoints(m);
  const pts = m.type === "confidence" ? "worth a confidence value" : p === null ? "worth the wager" : `${p} point${p === 1 ? "" : "s"}`;
  const t = m.timeLimit === undefined || m.timeLimit === "" ? null : Number(m.timeLimit) === 0 ? "no timer" : `${m.timeLimit}-second timer`;
  const g = m.maxGuesses === undefined || m.maxGuesses === "" ? null : Number(m.maxGuesses) === 0 ? "unlimited guesses" : `${m.maxGuesses} guess${Number(m.maxGuesses) === 1 ? "" : "es"}`;
  return [m.section ? h("span", { class: "badge" }, m.section) : null, h("span", { class: "badge quiet" }, pts),
    t ? h("span", { class: "badge quiet", title: "This question's own time limit" }, t) : null,
    g ? h("span", { class: "badge quiet", title: "This question's own guess limit" }, g) : null];
}

// ---- removing, with a way back ----
let removed = null; // { kind: "question" | "round", r, i?, item }
let undoTimer;
function remember(entry) {
  removed = entry;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { removed = null; $("#undo")?.remove(); }, 10000); // goes quietly: a redraw would take the cursor from whatever is being typed
}
function undoRemove() {
  if (!removed) return;
  if (removed.kind === "round") state.rounds.splice(removed.r, 0, removed.item);
  else state.rounds[Math.min(removed.r, state.rounds.length - 1)].modules.splice(removed.i, 0, removed.item);
  removed = null; clearTimeout(undoTimer); render();
}
const undoToast = () => removed ? h("div", { class: "undo", id: "undo", role: "status" },
  h("span", {}, removed.kind === "round" ? `Removed "${removed.item.title}".` : "Question removed."),
  h("button", { class: "primary", onclick: undoRemove }, "Undo")) : null;

/** After collapsing a long question from its bottom, bring its folded card back into view. */
function scrollToCard(r, i) {
  const c = [...document.querySelectorAll(".round")][r]?.querySelectorAll(".mod")[i];
  if (c && c.getBoundingClientRect().top < 0) c.scrollIntoView({ block: "center" });
}

function card(r, i, m) {
  const def = byType[m.type];
  const el = h("div", { class: "mod", draggable: "true" });
  el.addEventListener("dragstart", (e) => { if (e.target !== el) return; drag = { from: "card", r, i }; e.dataTransfer.setData("text/plain", "m"); e.stopPropagation(); });
  el.addEventListener("dragover", (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add("over"); });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); drop(r, i); });
  const list = state.rounds[r].modules;
  const move = (d) => () => { const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; render(); };
  const toggle = () => { m.open = !m.open; render(); };
  const duplicate = () => { const copy = JSON.parse(JSON.stringify(m)); copy.open = true; copy._preview = false; list.splice(i + 1, 0, copy); render(); };
  const remove = () => { list.splice(i, 1); remember({ kind: "question", r, i, item: m }); render(); };
  const q = String(m.config.question ?? "").trim().split("\n")[0];
  const main = def.fields.filter((f) => !f.advanced);
  const more = def.fields.filter((f) => f.advanced);
  const { n, first, head } = runInfo(m);
  const isConf = m.type === "confidence";
  const inRun = n > 1 && (isConf || !!secKey(m.section));
  if (inRun) el.classList.add("inrun");
  const bad = saveProblems.filter((p) => p.round === r && p.question === i);
  if (bad.length) el.classList.add("bad");
  const bar = first && (isConf || inRun)
    ? h("div", { class: "runbar" }, h("strong", {}, isConf ? `Confidence set${secKey(m.section) ? ` · ${canon(m.section)}` : ""}` : canon(m.section)),
        h("span", { class: "muted" }, `${n} question${n === 1 ? "" : "s"}${isConf ? ` · values ${(m.config.poolValues ?? []).join(", ")}` : ""}`),
        isConf ? runWarnings(head, n).map((w) => h("p", { class: "warnline" }, w)) : null)
    : null;
  const extras = {
    picker: m.type === "multiple_choice" && m.open ? correctPicker(m) : null,
    chips: TYPED.has(m.type) && m.open ? acceptChips(m) : null,
  };
  mount(el, bar,
    bad.length ? h("div", { class: "badnote", role: "alert" }, bad.map((p) => h("p", {}, p.detail))) : null,
    h("div", { class: "head" }, h("strong", { class: "grow title", role: "button", tabindex: "0", "aria-expanded": m.open ? "true" : "false",
      title: m.open ? "Click to collapse this question" : "Click to open this question",
      onclick: toggle, onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } },
      h("span", { class: "chev", "aria-hidden": "true" }, m.open ? "▾" : "▸"), ` ${i + 1}. ${def.label}`), h("div", { class: "tools" }, h("span", { class: "group" },
      h("button", { class: m.open ? "collapse-btn" : "", onclick: toggle, "aria-expanded": m.open ? "true" : "false" }, m.open ? "▴ Collapse" : "Edit"),
      h("button", { onclick: () => { m._preview = !m._preview; render(); }, "aria-expanded": m._preview ? "true" : "false", title: "See it as a phone and the TV will show it" }, m._preview ? "Hide preview" : "Preview"),
      h("button", { onclick: duplicate, title: "Make a copy just below" }, "Duplicate")), h("span", { class: "group" },
      h("button", { onclick: move(-1), "aria-label": "Move up", title: "Move up" }, "↑"), h("button", { onclick: move(1), "aria-label": "Move down", title: "Move down" }, "↓"),
      h("button", { class: "danger", onclick: remove, "aria-label": "Remove", title: "Remove (you can undo)" }, "✕")))),
    m.open ? [
      isConf ? sectionPicker(m, "Confidence set", "Confidence questions in a row with the same section share one list of values, and each team spends each value once.") : null,
      main.map((f) => fieldRow(m, f, extras)),
      TYPED.has(m.type) || m.type === "nsome" ? tryBox(m) : null,
      h("details", { class: "more" }, h("summary", {}, "More options"),
        isConf ? null : sectionPicker(m, "Section", "Groups questions under a heading, like Hodgepodge or Three Actors and a Year. Questions in a row with the same section are numbered 1/6, 2/6 and so on."),
        more.map((f) => fieldRow(m, f, extras)),
        defaulted(m, "maxGuesses", Number(state.settings.maxGuesses), { label: "Guesses for this question", help: "0 means unlimited (up to 20). Changing an answer uses a guess.", min: 0, max: 50, describe: describeGuesses }),
        defaulted(m, "timeLimit", Number(state.settings.timeLimit), { label: "Time limit in seconds", help: "0 means no timer: the question stays open until you close it.", min: 0, max: 3600, describe: describeTime })),
      h("button", { class: "collapsebar", onclick: () => { m.open = false; render(); scrollToCard(r, i); } }, "▴ Collapse this question"),
    ] : h("div", { class: "sum", onclick: toggle }, h("span", {}, q || "(no question yet)"), badges(m)),
    m._preview ? previewBlock(r, i, m) : null);
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
    type: "N-some (list several)",
    q: "Name three of the four Beatles.",
    a: "John Lennon\nPaul McCartney\nGeorge Harrison\nRingo Starr\nPlayers list 3 things. Each right one is worth 1 point, and getting all three earns 2 more, so a team can score 5.",
    why: "Each right item scores and getting them all earns a bonus. Accept more answers than you ask for when there are several right ones. The optional catch-all box lets a team add one more idea for you to judge by hand.",
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

function helpCards() {
  return [
    h("details", { class: "card help", open: true },
      h("summary", {}, h("strong", {}, "What makes a good question")),
      h("ul", {}, TIPS.map((t) => h("li", {}, t))),
      h("p", {}, h("a", { href: "https://github.com/NikaPunt/supra-trivia/blob/main/docs/GUIDELINES.md", target: "_blank", rel: "noopener" }, "Read the full question-writing guidelines"))),
    h("details", { class: "card help", open: true },
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
      labelled("The theme", "Keep it short, because you grade the guesses against it. A guess that matches it word for word is approved by itself when the theme goes public.", "Only you see this until the theme goes public."),
      h("input", { value: s.theme.secret, maxlength: 200, oninput: (e) => { s.theme.secret = e.target.value; } }),
      labelled("Hint", "Every phone shows it under \"Don't forget the secret theme!\" until the theme goes public."),
      h("input", { value: s.theme.hint ?? "", maxlength: 300, oninput: (e) => { s.theme.hint = e.target.value; } }),
      labelled("Explanation", "The phones and the TV show it once the theme goes public."),
      h("textarea", { rows: 3, maxlength: 600, oninput: (e) => { s.theme.formal = e.target.value; } }, s.theme.formal ?? ""),
      labelled("Points for finding it", "The same for every team, however early it guessed. Bonuses stay hidden from every scoreboard until the theme goes public."),
      h("input", { type: "number", min: 0.5, max: 100, step: 0.5, value: s.theme.bonus ?? 4, oninput: (e) => { s.theme.bonus = e.target.value; } }),
      h("p", { class: "muted" }, state.rounds.length > 1
        ? `Teams guess whenever they like and you approve the guesses. It goes public when round 2 ("${state.rounds[1].title}") starts, when every team has found it, or when you reveal it.`
        : "Teams guess whenever they like and you approve the guesses. With only one round it goes public at the end of the game, unless every team finds it or you reveal it sooner.")) : null);
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

// ---- the page: a save bar that stays in view, then tabs ----
let tab = (() => { try { return sessionStorage.getItem("builder-tab") || "questions"; } catch { return "questions"; } })();
let addingTo = null; // the round whose "+ Add question" list is open
const go = (key) => { tab = key; try { sessionStorage.setItem("builder-tab", key); } catch { /* fine */ } render(); window.scrollTo({ top: 0 }); };

async function practice(e) {
  if (dirty()) {
    if (!confirm("A practice run uses the saved trivia. Save your changes first?")) return;
    await save();
    if (dirty() || saveProblems.length) return; // the save was refused; the page says why
  }
  e.target.disabled = true;
  try { const s = await api(`/api/trivias/${id}/sessions`, { method: "POST", body: { practice: true } }); location.href = `/session.html?id=${s.id}`; }
  catch (err) { e.target.disabled = false; $("#err").textContent = `Could not start a practice run: ${err.message}`; }
}

function saveBar() {
  return [h("input", { class: "titlebox", value: state.title, maxlength: 120, "aria-label": "Trivia title", oninput: (e) => { state.title = e.target.value; } }),
    h("div", { class: "savebar" },
    h("div", { class: "row" },
      h("span", { id: "dirty", class: "dirty grow" }),
      h("button", { class: "primary", onclick: save }, "Save"),
      id ? h("button", { onclick: practice, title: "Rehearse with two bot teams before the real night" }, "Practice run") : null,
      h("a", { class: "btn", href: "/host.html" }, "Back")),
    h("div", { class: "err", id: "err", role: "alert" }, problemList()),
    id ? h("p", { class: "muted", id: "draftnote" }) : null)];
}

function tabs(report) {
  const n = report.warnings.length;
  const defs = [["questions", "Questions"], ["settings", "Settings & theme"], ["tips", "Tips & examples"], ["ready", n ? `Ready to host? (${n} to check)` : "Ready to host?"]];
  return h("div", { class: "tabs builder-tabs", role: "tablist", "aria-label": "Builder" }, defs.map(([key, label]) =>
    h("button", { role: "tab", "aria-selected": String(tab === key), class: tab === key ? "on" : "", onclick: () => go(key) }, label)));
}

function addRow(ri) {
  const list = state.rounds[ri].modules;
  if (addingTo !== ri) return h("button", { class: "addq", onclick: () => { addingTo = ri; render(); } }, "+ Add question");
  return h("div", { class: "addrow" }, h("span", { class: "muted" }, "Choose the kind of question to add:"),
    mods.map((t) => h("button", { title: t.description, onclick: () => { list.push(blank(t.type, list.at(-1))); addingTo = null; render(); } }, t.label)),
    h("button", { class: "linklike plain", onclick: () => { addingTo = null; render(); } }, "Cancel"));
}

function questionsTab(total) {
  const all = allMods();
  return [
    h("div", { class: "row" },
      h("span", { class: "muted" }, `${total} question${total === 1 ? "" : "s"}`),
      blankCount() ? h("span", { class: "warnline" }, `${blankCount()} empty question${blankCount() === 1 ? "" : "s"}: fill ${blankCount() === 1 ? "it" : "them"} in or remove ${blankCount() === 1 ? "it" : "them"} before saving`) : null,
      h("span", { class: "grow" }),
      total ? h("button", { onclick: () => { const open = !all.every((m) => m.open); for (const m of all) m.open = open; render(); } }, all.every((m) => m.open) ? "Collapse all" : "Expand all") : null,
      h("button", { onclick: exportJson }, "Export JSON"), h("button", { onclick: () => $("#file").click() }, "Import JSON"),
      !id && !total ? h("button", { onclick: loadSample }, "Load sample trivia") : null,
      h("input", { id: "file", type: "file", accept: "application/json,.json", style: "display:none", onchange: importFile })),
    total === 0 ? h("div", { class: "card note" }, h("strong", {}, "New here? "), "Add a question with + Add question below, or load the sample trivia to see a whole night put together. ",
      h("button", { class: "linklike plain", onclick: () => go("tips") }, "Tips and an example of every question type"), " are in their own tab.") : null,
    typoCard(),
    h("div", { class: "builder" },
      h("aside", { class: "palette card" }, h("h2", {}, "Question types"), h("p", { class: "muted" }, "Drag onto a round, or click to add to the last round."),
        mods.map((m) => { const c = h("div", { class: "chip", draggable: "true", title: m.description, onclick: () => { const l = state.rounds.at(-1).modules; l.push(blank(m.type, l.at(-1))); render(); } }, m.label, h("small", {}, m.description));
          c.addEventListener("dragstart", (e) => { drag = { from: "palette", type: m.type }; e.dataTransfer.setData("text/plain", "p"); }); return c; })),
      h("section", {}, state.rounds.map((r, ri) => {
        const zone = h("div", { class: "dropzone" });
        zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
        zone.addEventListener("dragleave", () => zone.classList.remove("over"));
        zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("over"); drop(ri); });
        mount(zone, r.modules.map((m, i) => card(ri, i, m)), r.modules.length ? null : h("p", { class: "muted" }, "Drop question types here, or use + Add question"));
        const sum = roundSummary(r, state.settings);
        return h("div", { class: "round" },
          h("div", { class: "row" }, h("input", { class: "grow", value: r.title, maxlength: 100, "aria-label": "Round title", oninput: (e) => { r.title = e.target.value; } }),
            state.rounds.length > 1 ? h("button", { class: "danger", onclick: () => { state.rounds.splice(ri, 1); remember({ kind: "round", r: ri, item: r }); render(); } }, "Remove round") : null),
          sum.count ? h("p", { class: "muted roundsum" }, `This round has ${sum.count} question${sum.count === 1 ? "" : "s"}, worth up to ${sum.points} point${sum.points === 1 ? "" : "s"}${sum.open ? " plus wagers" : ""}, and takes about ${formatMinutes(sum.minutes)}.`) : null,
          zone, addRow(ri));
      }), h("button", { onclick: () => { state.rounds.push({ title: `Round ${state.rounds.length + 1}`, modules: [] }); render(); } }, "+ Add round"))),
  ];
}

function settingsTab() {
  return [
    h("div", { class: "card" },
      labelled("Guesses each team gets per question", "3 means the first answer plus two changes: changing an answer uses a guess, and all the phones of a team share them. 0 means unlimited (up to 20). A question can have its own under More options.", null, "mg"),
      h("input", { id: "mg", type: "number", min: 0, max: 50, value: state.settings.maxGuesses, oninput: (e) => { state.settings.maxGuesses = e.target.value; }, onchange: (e) => { if (e.target.value === "") state.settings.maxGuesses = 3; render(); } }),
      h("p", { class: "muted" }, "Players never see whether a guess was right until you reveal. You can always award points by hand, including half marks."),
      labelled("Time per question in seconds", "Answers close by themselves when time runs out, so 180 gives teams 3 minutes. 0 means there is no timer. You can close sooner, add 30 seconds or pause while a question is open, and give one question its own time under More options.", null, "tl"),
      h("input", { id: "tl", type: "number", min: 0, max: 3600, step: 5, value: state.settings.timeLimit, oninput: (e) => { state.settings.timeLimit = e.target.value; }, onchange: (e) => { if (e.target.value === "") state.settings.timeLimit = 180; render(); } }),
      h("p", { class: "muted" }, `${describeTime(Number(state.settings.timeLimit))} per question.`)),
    themeCard(),
  ];
}

function readyTab(report) {
  const toQuestion = (at) => () => { tab = "questions"; try { sessionStorage.setItem("builder-tab", tab); } catch {} showQuestion(at.r, at.i); };
  return [
    dirty() ? h("div", { class: "card warn" }, h("strong", {}, "You have unsaved changes. "), "Hosting and practice runs use the saved trivia, so save first.") : null,
    h("div", { class: "card" }, h("h2", {}, "The night at a glance"), h("ul", {}, report.facts.map((t) => h("li", {}, t)))),
    h("div", { class: "card" }, h("h2", {}, report.warnings.length ? `Check these (${report.warnings.length})` : "Nothing to check"),
      report.warnings.length ? h("ul", { class: "checks" }, report.warnings.map((w) => h("li", {}, w.at ? h("button", { class: "linklike", onclick: toQuestion(w.at) }, w.text) : w.text)))
        : h("p", { class: "muted" }, "No empty questions, missing answers or likely \"no match\" spellings found.")),
    h("div", { class: "card" }, h("h2", {}, "How scoring will behave"), h("ul", {}, report.rules.map((t) => h("li", {}, t)))),
    h("div", { class: "card" }, h("h2", {}, "Rehearse it"),
      h("p", {}, "A practice run opens the host console with two bot teams, one always right and one always wrong. They answer when you press Close answers, so you can try marking, revealing, Go back and the round-end scoreboard. Open the projector view on a second screen, and join from your phone with the room code to see what players see. End the session when you are done."),
      id ? h("button", { class: "primary", onclick: practice }, "Start a practice run") : h("p", { class: "muted" }, "Save the trivia first to start a practice run.")),
  ];
}

function render() {
  syncRuns();
  cacheDraft();
  const total = state.rounds.reduce((a, r) => a + r.modules.length, 0);
  const report = readiness(toEditorState());
  mount($("#app"),
    draftBanner(),
    saveBar(),
    tabs(report),
    tab === "settings" ? settingsTab() : tab === "tips" ? helpCards() : tab === "ready" ? readyTab(report) : questionsTab(total),
    undoToast());
  dirtyMark();
  note();
  requestAnimationFrame(fitPreviews);
}

addEventListener("resize", () => requestAnimationFrame(fitPreviews));

/** Shrinks each TV preview's text until it fits, as the real projector page does, and says so. */
function fitPreviews() {
  for (const tv of document.querySelectorAll(".preview .tv")) {
    // The TV is laid out at 1280 by 720, like a real screen, then scaled down as a whole to fit this page.
    tv.style.setProperty("--k", String(tv.parentElement.clientWidth / 1280));
    let size = 1;
    tv.style.setProperty("--s", "1");
    while (tv.scrollHeight > tv.clientHeight + 1 && size > 0.35) { size -= 0.05; tv.style.setProperty("--s", String(size)); }
    const say = tv.closest("figure").querySelector(".fitnote");
    if (say) say.textContent = size < 0.999 ? `The TV will shrink this question's text to ${Math.round(size * 100)}% of its usual size so that it fits.${size < 0.6 ? " That may be hard to read from the back of the room." : ""}` : "";
  }
}

/** The trivia as the checks read it: the editor's state with the theme only when it is filled in. */
const toEditorState = () => ({ title: state.title, settings: state.settings, rounds: state.rounds });

async function save() {
  if (saveProblems.length) { saveProblems = []; render(); } // the page is rebuilt, so look the message box up after this
  const err = $("#err");
  clearTimeout(draftTimer); clearTimeout(serverTimer);
  await inflight; // a draft upload still on its way must not land after the save
  try {
    if (id) {
      // Say which saved version this page started from, so work saved elsewhere since is never overwritten unseen.
      let r;
      try { r = await api(`/api/trivias/${id}`, { method: "PUT", body: { ...toApi(), ...(savedAt ? { base: savedAt } : {}) } }); }
      catch (e) {
        if (e.status !== 409 || !e.conflict) throw e;
        if (!confirm("This trivia was saved somewhere else since you opened it here (another tab or device, or an admin).\n\nOK: save this page's version over it.\nCancel: keep the other version; nothing here is lost, and you can export it or reload to see theirs.")) {
          err.style.color = ""; err.textContent = "This was not saved, because the trivia was changed somewhere else. Your work here is still on this page.";
          return;
        }
        r = await api(`/api/trivias/${id}`, { method: "PUT", body: toApi() });
      }
      if (r.updated_at) savedAt = r.updated_at;
    }
    else { const r = await api("/api/trivias", { method: "POST", body: toApi() }); baseline = snap(); clearLocal(); location.href = `/builder.html?id=${r.id}`; return; }
    baseline = snap(); clearLocal(); serverDraft = false; localFailed = false; serverFailed = ""; lastBackup = ""; note(); dirtyMark();
    err.style.color = "var(--ok)"; err.textContent = "Saved.";
  } catch (e) {
    err.style.color = "";
    if (e.problems?.length) { showProblems(e.problems); return; }
    err.textContent = `Could not save: ${e.message}`;
  }
}

// ---- what went wrong with a save, in words, with a way to get to each question ----
const blankCount = () => state.rounds.reduce((a, r) => a + r.modules.filter(isBlank).length, 0);
function problemList() {
  if (!saveProblems.length) return null;
  return h("div", { class: "problems" },
    h("p", {}, h("strong", {}, `Not saved. ${saveProblems.length === 1 ? "One thing needs" : `${saveProblems.length} things need`} fixing first:`)),
    h("ul", {}, saveProblems.map((p) => h("li", {}, p.question !== null
      ? h("button", { class: "linklike", onclick: () => showQuestion(p.round, p.question) }, p.message)
      : p.message))));
}
function showProblems(problems) {
  saveProblems = problems;
  for (const p of problems.slice(0, 10)) { const m = state.rounds[p.round]?.modules[p.question]; if (m) m.open = true; }
  if (problems.some((p) => p.question !== null)) tab = "questions";
  render();
}
function showQuestion(r, i) {
  const m = state.rounds[r]?.modules[i]; if (!m) return;
  if (!m.open || tab !== "questions") { m.open = true; tab = "questions"; render(); }
  const card = [...document.querySelectorAll(".round")][r]?.querySelectorAll(".mod")[i];
  card?.scrollIntoView({ block: "center", behavior: "smooth" });
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
