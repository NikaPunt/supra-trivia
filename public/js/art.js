// Small paintings in the manner of Niko Pirosmani: flat colour, black outlines, one thing in the middle, no perspective.
// Decorative only, drawn in a fixed palette on their own dark ground so they read in the dark and the cream version alike.
// Shown only in the Pirosmani look (see ".art" in styles.css). All markup here is constant; nothing user-supplied goes in.
const INK = "#0b0a08", NAVY = "#142252", OCHRE = "#e0a82e", OLIVE = "#6f7a24", GRASS = "#a2a73a", DARK_GRASS = "#2b3012", VERM = "#c93a22", CREAM = "#efe6cf", TAN = "#e3c39a", WINE = "#3b1f3f", BROWN = "#2a1d10", CLOTH = "#e4d9bc";
const S = `stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"`;

const moon = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r * 1.45}" fill="${CREAM}" opacity=".13"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="${CREAM}"/>`;
const hills = (y = 150) => `<path d="M0 ${y}C60 ${y - 14} 120 ${y - 4} 180 ${y - 8}S280 ${y - 16} 320 ${y - 6}V200H0Z" fill="#4f5b1c"/><path d="M0 ${y + 26}C90 ${y + 18} 200 ${y + 30} 320 ${y + 22}V200H0Z" fill="${DARK_GRASS}"/>`;

const jug = (x, y, fill = VERM, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M-17 0C-26-6-28-30-16-44H16C28-30 26-6 17 0Z" fill="${fill}" ${S}/><rect x="-7" y="-60" width="14" height="18" rx="2" fill="${fill}" ${S}/><ellipse cx="0" cy="-61" rx="10" ry="3.5" fill="${OCHRE}" ${S}/><path d="M16-40c14-2 15 16 2 20" fill="none" ${S}/><path d="M-10-34c-3 8-3 16 0 22" fill="none" stroke="${CREAM}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/></g>`;
const bread = (x, y, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M-30 0C-24-17 24-17 30 0Z" fill="#d9a05b" ${S}/><path d="M-16-9l4 8M-4-12l4 11M8-10l4 10" stroke="${BROWN}" stroke-width="2" stroke-linecap="round"/></g>`;
const grapes = (x, y, k = 1) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M-2-24c8-12 20-10 22-2-8-1-16 0-22 2Z" fill="${OLIVE}" ${S}/>${[[-9, -14], [0, -14], [9, -14], [-5, -6], [5, -6], [0, 2]].map(([a, b]) => `<circle cx="${a}" cy="${b}" r="5.4" fill="${WINE}" stroke="${INK}" stroke-width="1.6"/>`).join("")}</g>`;
const horn = (x, y, k = 1, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${k})"><path d="M-28-14C-20 10 6 18 30 10C14 6 0-4-8-20Z" fill="${CREAM}" ${S}/><path d="M-28-14C-20-20-12-22-8-20" fill="none" ${S}/><path d="M-26-14l16 2" stroke="${OCHRE}" stroke-width="5" stroke-linecap="round"/><path d="M-18 2c8 6 18 9 28 8" fill="none" stroke="${BROWN}" stroke-opacity=".35" stroke-width="2"/></g>`;
const cloth = (x, w, y, h) => `<rect x="${x}" y="${y}" width="${w}" height="9" fill="${CREAM}" ${S}/><rect x="${x + 6}" y="${y + 9}" width="${w - 12}" height="${h}" fill="${CLOTH}" stroke="${INK}" stroke-width="2"/>`;
const man = (x, y, k = 1, o = {}) => `<g transform="translate(${x} ${y}) scale(${k})"><path d="M-17 0V-34C-17-46 17-46 17-34V0Z" fill="${INK}"/><path d="M-5-40l5 14 5-14Z" fill="${CREAM}"/>${o.sash ? `<path d="M-17-20L17-6" stroke="${VERM}" stroke-width="5"/>` : ""}<circle cx="0" cy="-52" r="9.5" fill="${TAN}" ${S}/><path d="M-12-58h24l-3-9h-18Z" fill="${INK}"/><path d="M-5-50q5 4 10 0" fill="none" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><circle cx="-3.6" cy="-54" r="1.3" fill="${INK}"/><circle cx="3.6" cy="-54" r="1.3" fill="${INK}"/></g>`;

const frame = (inner, bg = NAVY) => `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice"><rect width="320" height="200" fill="${bg}"/>${inner}</svg>`;

const PAINTINGS = {
  // The table is laid and the guests have not come yet: the lobby.
  table: frame(`${moon(256, 42, 17)}${hills(150)}
    ${cloth(46, 228, 112, 36)}
    ${jug(82, 112, VERM, 1)}${bread(134, 112, 1)}${grapes(182, 112, 1)}${horn(228, 102, 1)}${jug(262, 112, OCHRE, .85)}
    <path d="M60 148v26M260 148v26" stroke="${BROWN}" stroke-width="7" stroke-linecap="round"/>`),

  // A break between rounds: bread, wine and a jug on black oilcloth.
  still: frame(`<g fill="none" stroke="${OCHRE}" stroke-width="2"><rect x="14" y="14" width="292" height="172" rx="3" opacity=".7"/></g>
    <rect x="30" y="140" width="260" height="10" fill="${CREAM}" ${S}/><rect x="38" y="150" width="244" height="30" fill="${CLOTH}" stroke="${INK}" stroke-width="2"/>
    ${jug(160, 140, OCHRE, 1.5)}${bread(86, 140, 1.25)}${grapes(236, 140, 1.4)}${horn(268, 128, .9, -6)}`, "#0b0a08"),

  // The bear sits and looks at the moon: paused.
  bear: frame(`${moon(226, 76, 46)}${hills(158)}
    <g ${S}><ellipse cx="108" cy="140" rx="44" ry="48" fill="#3a2312"/><ellipse cx="108" cy="146" rx="26" ry="32" fill="#5a3a20" stroke="none"/><circle cx="108" cy="86" r="25" fill="#3a2312"/><circle cx="90" cy="66" r="8" fill="#3a2312"/><circle cx="126" cy="66" r="8" fill="#3a2312"/><ellipse cx="108" cy="95" rx="12" ry="9" fill="#8a5a32"/><ellipse cx="108" cy="91" rx="4.5" ry="3" fill="${INK}"/><ellipse cx="62" cy="150" rx="12" ry="24" fill="#3a2312" transform="rotate(14 62 150)"/><ellipse cx="154" cy="150" rx="12" ry="24" fill="#3a2312" transform="rotate(-14 154 150)"/><ellipse cx="86" cy="184" rx="18" ry="9" fill="#3a2312"/><ellipse cx="130" cy="184" rx="18" ry="9" fill="#3a2312"/></g>
    <circle cx="98" cy="82" r="3" fill="${CREAM}"/><circle cx="118" cy="82" r="3" fill="${CREAM}"/><circle cx="99" cy="82.5" r="1.4" fill="${INK}"/><circle cx="119" cy="82.5" r="1.4" fill="${INK}"/>`),

  // A giraffe and two trees: for empty places.
  giraffe: frame(`${moon(54, 40, 15)}${hills(158)}
    <g ${S}><rect x="86" y="132" width="7" height="46" fill="#d9a05b"/><rect x="104" y="136" width="7" height="42" fill="#d9a05b"/><rect x="178" y="136" width="7" height="42" fill="#d9a05b"/><rect x="198" y="132" width="7" height="46" fill="#d9a05b"/>
    <path d="M82 124C84 100 200 98 206 122C208 138 90 142 82 124Z" fill="${OCHRE}"/><path d="M178 118L194 42L212 46L206 122Z" fill="${OCHRE}"/><path d="M82 126c-14-2-18 14-10 24" fill="none"/>
    <ellipse cx="207" cy="40" rx="19" ry="10" fill="${OCHRE}" transform="rotate(-12 207 40)"/><path d="M190 36l-8 6" /><path d="M200 29l-3-12M210 30l2-13" /><circle cx="197" cy="16" r="3" fill="${BROWN}"/><circle cx="212" cy="16" r="3" fill="${BROWN}"/></g>
    <g fill="#8a4a1a"><ellipse cx="108" cy="118" rx="9" ry="7"/><ellipse cx="136" cy="112" rx="11" ry="8"/><ellipse cx="166" cy="116" rx="9" ry="7"/><ellipse cx="124" cy="132" rx="8" ry="6"/><ellipse cx="156" cy="130" rx="8" ry="6"/><ellipse cx="190" cy="92" rx="7" ry="9"/><ellipse cx="196" cy="64" rx="6" ry="8"/><ellipse cx="186" cy="110" rx="6" ry="7"/></g>
    <circle cx="206" cy="38" r="3.2" fill="${CREAM}"/><circle cx="206.6" cy="38.4" r="1.5" fill="${INK}"/>
    <g ${S}><rect x="256" y="104" width="7" height="68" fill="${BROWN}"/><ellipse cx="259" cy="96" rx="28" ry="26" fill="${OLIVE}"/><rect x="26" y="130" width="6" height="44" fill="${BROWN}"/><ellipse cx="29" cy="124" rx="20" ry="19" fill="#55621f"/></g>`),

  // A man in a black coat raises the horn: the toast at the end.
  tamada: frame(`${moon(262, 40, 15)}<path d="M0 36q40-16 80 0t80 0 80 0 80 0V18H0Z" fill="${OLIVE}" opacity=".9"/>${[24, 70, 120, 176, 232, 288].map((x, i) => `<circle cx="${x}" cy="${44 + (i % 2) * 6}" r="5.5" fill="${WINE}" stroke="${INK}" stroke-width="1.4"/>`).join("")}
    ${hills(160)}
    ${man(78, 138, 1.15)}${man(242, 138, 1.15, { sash: true })}
    <g ${S}><path d="M160 156V86C160 66 196 66 196 86V156Z" fill="${INK}"/></g>
    <path d="M168 78l12 28 12-28Z" fill="${CREAM}"/><path d="M168 98L192 122" stroke="${VERM}" stroke-width="6"/>
    <circle cx="178" cy="54" r="15" fill="${TAN}" ${S}/><path d="M160 46h36l-5-18h-26Z" fill="${INK}"/>
    <circle cx="172" cy="52" r="2.2" fill="${INK}"/><circle cx="184" cy="52" r="2.2" fill="${INK}"/><path d="M168 62q10 7 20 0q-3 7-10 7t-10-7Z" fill="${INK}"/>
    <path d="M196 92L218 64" stroke="${INK}" stroke-width="9" stroke-linecap="round"/>${horn(232, 48, 1.05, -32)}
    ${cloth(30, 260, 150, 20)}`),
};

/** A small painting in a painted frame. `size` is "sm" (a spot), "md" or "wide". */
export function art(name, { size = "md", label = "" } = {}) {
  const el = document.createElement("div");
  el.className = `art plate ${size}`;
  if (label) { el.setAttribute("role", "img"); el.setAttribute("aria-label", label); } else el.setAttribute("aria-hidden", "true");
  el.innerHTML = PAINTINGS[name]; // constant markup, no user data
  return el;
}
export const PLATES = Object.keys(PAINTINGS);

/** The wine horn on its own, as a small mark beside the winner's name. Fixed colours. */
export const HORN_MARK = `<svg class="horn" viewBox="-34 -26 68 48" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${horn(0, 0, 1, 0)}</svg>`;
