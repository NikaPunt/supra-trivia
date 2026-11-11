import { $, api, connectionNote, enterIfChanged, h, keepAwake, live, mount, questionBlock, revealBlock, scene, art, scoreSign, stable, syncClock, themeNote, timerOf } from "./common.js";
const id = new URLSearchParams(location.search).get("id");
// The projector scales with the screen, so a 4K display is not a small column on a big black field.
document.documentElement.classList.add("deck");

function board(s) {
  return s.leaderboard ? scoreSign(s.phase === "ended" ? "Final scores" : "Scores after this round", s.leaderboard, { ended: s.phase === "ended", deck: true }) : null;
}

const foot = (s) => h("div", { class: "ft" }, h("span", {}, `Join at ${location.host}`), h("span", {}, `Room ${s.code}`));

function render(s) {
  if (s.phase === "lobby") return mount($("#app"), scene(), h("div", { class: "lobby" }, h("h1", {}, s.title), h("p", { class: "muted" }, `Join at ${location.host}`), h("div", { class: "code" }, s.code), h("p", { class: "muted" }, `${s.players} at the table`)), themeNote(s.theme));
  if (s.phase === "ended") {
    return mount($("#app"), art("tamada", { size: "wide" }), h("div", { class: "toast" }, h("span", { class: "geo" }, "გაუმარჯოს!"), h("span", { class: "plain" }, "Thanks for playing!")), themeNote(s.theme), board(s), foot(s));
  }
  const it = s.item;
  // After a round the scores are what the room is looking at: the question gives way to a single line with its answer.
  if (s.leaderboard && s.phase === "revealed") {
    return mount($("#app"),
      h("p", { class: "recap" }, h("span", { class: "muted" }, `${it.round} · the last answer: `), h("strong", {}, it.solution ?? "")),
      board(s), foot(s));
  }
  mount($("#app"),
    questionBlock(it, timerOf(s)),
    s.paused ? h("div", { class: "paused-banner" }, art("bear", { size: "thumb" }), h("span", {}, "Paused")) : null,
    it.public.options ? h("ol", {}, it.public.options.map((o) => h("li", {}, o))) : null,
    s.phase === "revealed" ? revealBlock(it) : h("p", { class: "muted" }, s.phase === "closed" ? "Answers closed" : it.stage === "wager" ? `${s.wagered}/${s.players} wagered` : `${s.answered}/${s.players} locked in`),
    themeNote(s.theme), board(s), foot(s));
}

const anim = {};
let lastRaw = "";
const conn = connectionNote(8000); // the TV is in front of the room: say nothing at all for a blip
let drawn = false;
async function refresh() {
  try {
    const s = await api(`/api/sessions/${id}/deck`);
    conn.ok();
    syncClock(s.timer);
    const raw = stable(s);
    if (raw === lastRaw) return; // nothing changed: leave the screen alone
    lastRaw = raw;
    render(s);
    drawn = true;
    enterIfChanged(`${s.number}:${s.phase}`, anim);
  } catch (e) {
    if (e.status === 401) { location.href = "/auth/login"; return; }
    lastRaw = ""; setTimeout(refresh, 3000); // forget what was drawn so the next good fetch redraws, and try again soon
    // The screen stays as it was; the room sees a small note only if the trouble goes on.
    if (drawn) conn.failed(); else mount($("#app"), h("p", { class: "err" }, e.message));
  }
}
refresh();
live(`/api/sessions/${id}/events`, refresh);
keepAwake();

// ---- sizing ----
// Browser zoom is shared by every tab of this site, so zooming the projector would also shrink the host console.
// The projector therefore fits itself to the screen and has its own text size, kept on this device for this page only.
const SIZE_KEY = "trivia-deck-size";
let size = 1;
try { size = Math.min(2, Math.max(0.5, Number(localStorage.getItem(SIZE_KEY)) || 1)); } catch { /* storage blocked: start at normal */ }
const root = document.documentElement;

/** Uses the size you chose, or the largest smaller size that still fits the whole screen without scrolling. */
function fit() {
  const set = (v) => root.style.setProperty("--deck-scale", v.toFixed(3));
  const fits = () => root.scrollHeight <= innerHeight + 2;
  set(size);
  if (fits()) return;
  let lo = 0.3, hi = size; // lo is the floor we settle for if nothing larger fits
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (fits()) lo = mid; else hi = mid;
  }
  set(lo);
}
const setSize = (v) => { size = Math.min(2, Math.max(0.5, Math.round(v * 100) / 100)); try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* fine */ } fit(); };
let resizing;
addEventListener("resize", () => { clearTimeout(resizing); resizing = setTimeout(fit, 100); });
new MutationObserver(() => requestAnimationFrame(fit)).observe($("#app"), { childList: true });
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input,select,textarea") || e.ctrlKey || e.metaKey) return;
  if (e.key === "+" || e.key === "=") setSize(size + 0.1);
  else if (e.key === "-") setSize(size - 0.1);
  else if (e.key === "0") setSize(1);
});
$("footer.foot")?.append(h("span", { class: "sizer" },
  h("button", { onclick: () => setSize(size - 0.1), "aria-label": "Smaller text" }, "A−"),
  h("button", { onclick: () => setSize(1), "aria-label": "Normal text size" }, "Fit"),
  h("button", { onclick: () => setSize(size + 0.1), "aria-label": "Larger text" }, "A+")));
fit();
