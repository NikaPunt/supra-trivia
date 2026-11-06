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

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `error ${res.status}`), { status: res.status });
  return data;
}

/** Refetch on server push, with a slow poll as a safety net. */
export function live(url, refresh) {
  let timer;
  const kick = () => { clearTimeout(timer); timer = setTimeout(refresh, 50); };
  const es = new EventSource(url);
  es.addEventListener("changed", kick);
  es.addEventListener("open", kick);
  setInterval(refresh, 15000);
}

export function describeAnswer(item, value) {
  const v = value?.[item.input.key];
  if (item.input.kind === "choice") return item.public.options?.[v] ?? item.config?.options?.[v] ?? "?";
  return String(v);
}

export async function hostHeader(el, { requireHost = true } = {}) {
  const { host } = await api("/api/me");
  if (!host && requireHost) { location.href = "/auth/login"; return null; }
  mount(el, h("a", { href: "/host.html", class: "btn" }, "Trivia"), h("span", { class: "grow" }),
    host.role === "admin" ? h("a", { href: "/admin.html", class: "btn" }, "Admin") : null,
    h("span", { class: "muted" }, host.name), h("span", { class: `badge ${host.role}` }, host.role),
    h("button", { onclick: async () => { await api("/auth/logout", { method: "POST" }); location.href = "/"; } }, "Log out"));
  return host;
}
