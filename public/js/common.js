import { connectionWatch, deckGrid } from "./layout.js";
import { HORN_MARK, art } from "./art.js";
export { art };

export const $ = (sel, el = document) => el.querySelector(sel);

/** Builds DOM safely: strings become text nodes, never HTML. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

export function mount(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
}

let memoDevice;
/** A random id for this phone, kept in the browser, so a team can tell its phones apart. It identifies nobody. */
export function deviceId() {
  try {
    let d = localStorage.getItem("trivia-device");
    if (!d) { d = (crypto.randomUUID?.() ?? `${Date.now()}${Math.random()}`.replace(/\D/g, "")).slice(0, 40); localStorage.setItem("trivia-device", d); }
    return d;
  } catch { return (memoDevice ??= (crypto.randomUUID?.() ?? String(Math.random()).slice(2) + "00000000")); }
}

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: { "x-device": deviceId(), ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `error ${res.status}`), { status: res.status, conflict: !!data.conflict, problems: Array.isArray(data.problems) ? data.problems : null });
  return data;
}

/**
 * Refetch when the server says something changed. The server also sends a ping on connect and every 15 seconds, so the page can
 * tell whether the live stream is really delivering. If it is not (a proxy that buffers or drops it, a flaky connection),
 * fall back to polling every few seconds so nothing lags, and go back to quiet checks once pings arrive again.
 */
export function live(url, refresh) {
  let timer, es, lastBeat = 0, ticks = 0;
  const kick = () => { clearTimeout(timer); timer = setTimeout(refresh, 50); };
  const connect = () => {
    es = new EventSource(url);
    es.addEventListener("changed", () => { lastBeat = Date.now(); kick(); });
    es.addEventListener("ping", () => { lastBeat = Date.now(); });
    es.addEventListener("open", () => kick()); // catch up after a (re)connect; only a real ping or change counts as proof the stream delivers
    es.addEventListener("error", () => { if (es.readyState === 2) setTimeout(connect, 3000); });
  };
  connect();
  const healthy = () => es.readyState === 1 && Date.now() - lastBeat < 22000;
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    ticks++;
    if (!healthy() || ticks % 10 === 0) refresh();
  }, 3000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
}

/** Marks the question and the reveal so they animate in once, when they change, and never on a plain refresh. */
export function enterIfChanged(key, state) {
  if (state.lastKey === key) return;
  state.lastKey = key;
  document.querySelectorAll("#app .board, #app .reveal").forEach((el) => el.classList.add("enter"));
}

/** What a player answered, with any stake (confidence points, wager) appended. */
export function describeAnswer(item, value) {
  const v = value?.[item.input.key];
  const text = item.input.kind === "choice" ? (item.public.options?.[v] ?? "?") : String(v);
  const stake = item.stakeKey ? value?.[item.stakeKey] : undefined;
  return stake === undefined ? text : `${text}  (stake ${stake})`;
}

// ---- the countdown ----

let skew = 0; // how far this device's clock is from the server's, in milliseconds
/** Call with every state you fetch: it keeps the countdown honest even if the device clock is wrong. */
export function syncClock(timer) { if (timer) skew = timer.now - Date.now(); }

/** The state without the server clock reading, so two fetches that differ only by the time compare as equal. */
export const stable = (state) => JSON.stringify(state, (k, v) => (k === "now" ? undefined : v));

export const clock = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/** What to show beside the round name: the timer, or just "Paused" when a question without a timer is on hold. */
export const timerOf = (s) => s.timer ?? (s.paused ? { paused: true } : null);

/** A live m:ss countdown. It updates itself, so the page never has to be redrawn for it. */
export function clockEl(timer) {
  if (!timer) return null;
  if (timer.paused) return h("span", { class: "clock paused", role: "timer" }, timer.left != null ? `Paused · ${clock(timer.left)}` : "Paused");
  const el = h("span", { class: "clock", role: "timer" });
  const tick = () => {
    if (!el.isConnected && el.dataset.ready) return clearInterval(id);
    el.dataset.ready = "1";
    const left = timer.deadline - (Date.now() + skew);
    el.textContent = left <= 0 ? "Time's up" : clock(left);
    el.classList.toggle("low", left > 0 && left <= 10000);
    el.classList.toggle("up", left <= 0);
  };
  const id = setInterval(tick, 250);
  tick();
  return el;
}

/** Stops phones and the projector from going to sleep mid-game, where the browser supports it. */
export function keepAwake() {
  const ask = async () => { try { if (document.visibilityState === "visible" && "wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch { /* denied or unsupported: harmless */ } };
  ask();
  document.addEventListener("visibilitychange", ask);
}

/**
 * The question as the host wrote it, on an open page: where we are (with the time left, if there is a timer), then the
 * text. Blank lines are kept, so a question can end with its ask ("Which Asian country is this?") on a line of its own.
 */
export function questionBlock(it, timer) {
  const where = `${it.round}${it.section ? `: ${it.section}` : ""}`;
  const paras = String(it.public.question).split(/\n+/).map((t) => t.trim()).filter(Boolean);
  return h("section", { class: "board" },
    h("div", { class: "where" }, h("span", {}, where, h("span", {}, ` · ${it.pos.n}/${it.pos.of}`)), clockEl(timer)),
    paras.map((t, i) => h("p", { class: paras.length > 1 && i === paras.length - 1 ? "ask" : "" }, t)));
}

/**
 * A reminder about the secret theme, or the theme itself once it is out. `extra` goes inside the card (the guess box).
 */
export function themeNote(t, ...extra) {
  if (!t) return null;
  if (t.revealed) {
    return h("div", { class: "note" }, h("b", {}, "The secret theme"), h("p", {}, h("strong", {}, t.secret)), t.formal ? h("p", {}, t.formal) : null, ...extra);
  }
  return h("div", { class: "note" }, h("b", {}, "Don't forget the secret theme!"), t.hint ? h("p", {}, `Hint: ${t.hint}`) : null, ...extra);
}

/** The reveal: the answer in display type, and the fun fact if there is one. */
export function revealBlock(it) {
  return it.solution
    ? h("section", { class: "reveal" }, h("div", { class: "eyebrow" }, "The answer"), h("div", { class: "answer" }, it.solution), it.funFact ? h("p", { class: "fact" }, it.funFact) : null)
    : null;
}

const SCENE = `<svg viewBox="0 0 800 240" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
<rect width="800" height="240" fill="#142252"/>
<circle cx="112" cy="54" r="31" fill="#efe6cf" opacity=".14"/><circle cx="112" cy="54" r="22" fill="#efe6cf"/>
<g><ellipse cx="90" cy="104" rx="84" ry="8" fill="#8ea0cb"/><ellipse cx="250" cy="86" rx="124" ry="11" fill="#cfd8ec"/><ellipse cx="330" cy="99" rx="150" ry="10" fill="#8ea0cb"/><ellipse cx="560" cy="78" rx="132" ry="10" fill="#cfd8ec"/><ellipse cx="650" cy="92" rx="112" ry="9" fill="#8ea0cb"/><ellipse cx="470" cy="104" rx="70" ry="7" fill="#aebbdc"/></g>
<g fill="none" stroke="#0b0a08" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M296 66q9-9 18 0q9-9 18 0"/><path d="M368 56q8-8 16 0q8-8 16 0"/><path d="M430 72q7-7 14 0q7-7 14 0"/></g>
<path d="M0 152C90 118 190 130 280 148S470 152 560 136S720 122 800 140V240H0Z" fill="#4f5b1c"/>
<path d="M0 178C120 160 240 174 360 169S600 160 800 174V240H0Z" fill="#a2a73a"/>
<path d="M0 210C150 199 330 216 480 207S720 201 800 209V240H0Z" fill="#2b3012"/>
<g><path d="M30 214c4-30 2-52 6-76" stroke="#2a1d10" stroke-width="9" fill="none" stroke-linecap="round"/><ellipse cx="34" cy="128" rx="30" ry="21" fill="#6f7a24"/><ellipse cx="58" cy="146" rx="20" ry="13" fill="#55621f"/></g>
<g><rect x="548" y="128" width="196" height="9" fill="#e0a82e"/><rect x="552" y="137" width="5" height="44" fill="#2a1d10"/><rect x="642" y="137" width="5" height="44" fill="#2a1d10"/><rect x="734" y="137" width="5" height="44" fill="#2a1d10"/><ellipse cx="570" cy="125" rx="24" ry="7" fill="#7c8a26"/><ellipse cx="640" cy="124" rx="28" ry="8" fill="#6f7a24"/><ellipse cx="714" cy="125" rx="26" ry="7" fill="#7c8a26"/>
<g fill="#3b1f3f"><circle cx="578" cy="145" r="4.5"/><circle cx="586" cy="145" r="4.5"/><circle cx="582" cy="152" r="4.5"/><circle cx="582" cy="159" r="4"/><circle cx="650" cy="145" r="4.5"/><circle cx="658" cy="145" r="4.5"/><circle cx="654" cy="152" r="4.5"/><circle cx="654" cy="159" r="4"/><circle cx="712" cy="145" r="4.5"/><circle cx="720" cy="145" r="4.5"/><circle cx="716" cy="152" r="4"/></g></g>
<g><g fill="#0b0a08"><rect x="590" y="156" width="11" height="22" rx="2"/><rect x="612" y="156" width="11" height="22" rx="2"/><rect x="636" y="158" width="11" height="22" rx="2"/><rect x="662" y="156" width="11" height="22" rx="2"/><rect x="686" y="158" width="11" height="22" rx="2"/><rect x="589" y="146" width="13" height="5" rx="1"/><rect x="611" y="146" width="13" height="5" rx="1"/><rect x="661" y="146" width="13" height="5" rx="1"/></g>
<g fill="#e3c39a"><circle cx="595.500" cy="153" r="5"/><circle cx="617.500" cy="153" r="5"/><circle cx="641.500" cy="154" r="5"/><circle cx="667.500" cy="153" r="5"/><circle cx="691.500" cy="154" r="5"/></g>
<rect x="580" y="176" width="124" height="9" fill="#efe6cf"/><rect x="584" y="185" width="116" height="18" fill="#e4d9bc"/></g>
<g><rect x="428" y="160" width="14" height="28" rx="3" fill="#c93a22"/><circle cx="435" cy="153" r="6" fill="#e3c39a"/><ellipse cx="435" cy="148" rx="13" ry="3.600" fill="#e0a82e"/><path d="M430 148q5-8 10 0z" fill="#e0a82e"/><rect x="429" y="188" width="5" height="12" fill="#0b0a08"/><rect x="437" y="188" width="5" height="12" fill="#0b0a08"/></g>
<g><ellipse cx="258" cy="190" rx="26" ry="11" fill="#e8dcc0"/><ellipse cx="232" cy="185" rx="10" ry="7.500" fill="#e8dcc0"/><path d="M226 178q-5-7-10-6M236 178q2-8 8-9" stroke="#2a1d10" stroke-width="2.200" fill="none" stroke-linecap="round"/><g fill="#2a1d10"><rect x="241" y="198" width="4" height="12"/><rect x="250" y="198" width="4" height="12"/><rect x="268" y="198" width="4" height="12"/><rect x="277" y="198" width="4" height="12"/></g></g>
</svg>`;

/** The painted night scene. Decorative and fixed in its own palette. */
export function scene() {
  const el = document.createElement("div");
  el.className = "scene";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = SCENE; // constant markup, no user data
  return el;
}

const MARK = `<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="10" fill="#142252"/><circle cx="40" cy="22" r="9" fill="#efe6cf"/><path d="M0 46Q18 36 34 44T64 40V64H0Z" fill="#6f7a24"/><path d="M0 54Q22 46 40 52T64 50V64H0Z" fill="#2a2f12"/><path d="M12 30q4-5 8 0q4-5 8 0" fill="none" stroke="#0b0a08" stroke-width="2.400" stroke-linecap="round"/></svg>`;

export const DESIGNS = [["pirosmani", "Pirosmani"], ["supper", "Supper club"], ["paper", "Paper & ink"], ["show", "Game show"]];

/** A dropdown for choosing the look. The choice is remembered on this device. */
export function designPicker() {
  const current = document.documentElement.dataset.design || "pirosmani";
  const sel = h("select", { "aria-label": "Look" }, DESIGNS.map(([v, label]) => h("option", { value: v, selected: v === current }, label)));
  sel.addEventListener("change", () => {
    document.documentElement.dataset.design = sel.value;
    try { localStorage.setItem("trivia-design", sel.value); } catch { /* private mode: the choice just won't stick */ }
  });
  return h("label", { class: "picker" }, h("span", {}, "Look"), sel);
}
document.querySelector("footer.foot")?.append(designPicker());

export function brand(href = "/") {
  const a = h("a", { href, class: "brand", "aria-label": "Trivia home" });
  a.innerHTML = MARK; // constant markup
  a.append(h("b", {}, "Trivia"), h("small", { class: "geo" }, "ვიქტორინა"));
  return a;
}

export async function hostHeader(el, { requireHost = true } = {}) {
  const { host } = await api("/api/me");
  if (!host && requireHost) { location.href = "/auth/login"; return null; }
  mount(el, brand("/"), h("a", { href: "/host.html", class: "btn" }, "My trivias"), h("span", { class: "grow" }),
    host.role === "admin" ? h("a", { href: "/admin.html", class: "btn" }, "Admin") : null,
    designPicker(), h("span", { class: "muted" }, host.name), h("span", { class: `badge ${host.role}` }, host.role),
    h("button", { onclick: async () => { await api("/auth/logout", { method: "POST" }); location.href = "/"; } }, "Log out"));
  return host;
}

// ---- the painted look ----

/**
 * Two filters that wobble an edge a little, so borders and signs look painted by hand instead of ruled. The Pirosmani look
 * uses them (see "brush" in styles.css); the other looks never refer to them. Constant markup, no user data.
 */
(function paintFilters() {
  if (document.getElementById("paint-filters")) return;
  const svg = document.createElement("div");
  svg.id = "paint-filters";
  svg.setAttribute("aria-hidden", "true");
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  svg.innerHTML = `<svg width="0" height="0" xmlns="http://www.w3.org/2000/svg"><defs>
    <filter id="brush" x="-3%" y="-8%" width="106%" height="116%"><feTurbulence type="fractalNoise" baseFrequency="0.016" numOctaves="1" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="brush-soft" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="1" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="brush-big" x="-3%" y="-12%" width="106%" height="124%"><feTurbulence type="fractalNoise" baseFrequency="0.008" numOctaves="1" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="brush-big-soft" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.006" numOctaves="1" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G"/></filter>
  </defs></svg>`;
  document.body.prepend(svg);
})();

/**
 * A scoreboard painted on a hanging sign: the rank in a medallion, the team's name, the points. After the last
 * question the winner gets the wine horn. `rows` are { nickname, points, me? } in rank order.
 */
export function scoreSign(title, rows, { ended = false, extra = null, deck = false } = {}) {
  // On the projector the board is the whole screen: long lists flow into columns and the text size follows the number of rows per column.
  const grid = deckGrid(rows.length);
  const style = deck ? `--cols:${grid.cols};--rows:${grid.rows}` : undefined;
  return h("div", { class: `card sign${deck ? " big" : ""}`, style },
    h("div", { class: "signhead" }, h("h2", {}, title), ended ? null : art("still", { size: "thumb" })),
    rows.map((r, i) => h("div", { class: `rank${r.me ? " me" : ""}` },
      h("span", { class: "who" }, h("span", { class: "pos" }, String(i + 1)), h("span", { class: "nm" }, r.nickname), ended && i === 0 ? hornMark() : null),
      h("span", { class: "pts" }, r.points))),
    extra);
}
function hornMark() {
  const s = document.createElement("span");
  s.className = "art hornmark";
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = HORN_MARK; // constant markup
  return s;
}

/** An empty list, with a giraffe to keep it company. */
export function emptyState(text) {
  return h("div", { class: "empty" }, art("giraffe", { size: "thumb" }), h("p", { class: "muted" }, text));
}

/**
 * A small "reconnecting" note for a page that keeps its screen up while the connection is down. It appears only after the
 * trouble has lasted `delay` ms, so a blip of a second or two is invisible, and it goes as soon as a refresh succeeds.
 */
export function connectionNote(delay = 4000) {
  return connectionWatch(delay,
    () => document.body.append(h("div", { id: "conn", class: "conn", role: "status" }, "Connection lost. Retrying…")),
    () => document.getElementById("conn")?.remove());
}
