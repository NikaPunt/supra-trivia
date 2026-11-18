// Pure helpers for the builder: what a trivia will be like to host, and other spellings worth accepting.
// No DOM here, so the tests can import this file directly.

const num = (v, d) => (v === "" || v == null || !Number.isFinite(Number(v)) ? d : Number(v));
const text = (v) => String(v ?? "").trim();
const lines = (v) => (Array.isArray(v) ? v : []).map(text).filter(Boolean);
const secKey = (s) => text(s).replace(/\s+/g, " ").toLowerCase();

/** The same forgiving comparison the server uses for typed answers. */
export const normalize = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Question types whose answer is typed and matched against a list of accepted answers, one per line. */
const TYPED = new Set(["text_qa", "confidence", "wager", "jeopardy"]);

/** A question the host has not started on (no text and no answers typed). */
export const isBlank = (m) => !Object.values(m.config ?? {}).some((v) => (typeof v === "string" && v.trim()) || (Array.isArray(v) && v.some((x) => typeof x === "string" && x.trim())));

/** Runs of neighbouring confidence questions with the same section, per round: each run shares one list of values. */
function confidenceSets(round) {
  const sets = [];
  round.modules.forEach((m, i) => {
    const last = sets.at(-1);
    if (m.type !== "confidence") return;
    if (last && last.end === i - 1 && secKey(round.modules[last.start].section) === secKey(m.section)) last.end = i;
    else sets.push({ start: i, end: i });
  });
  return sets;
}

/** The most one question can earn, or null when it depends on the game (a wager capped by score, a confidence value). */
export function maxPoints(m) {
  const c = m.config ?? {};
  switch (m.type) {
    case "nsome": return num(c.count, 3) * num(c.points, 1) + num(c.bonus, 2);
    case "wager": case "jeopardy": return c.capByScore ? null : num(c.maxWager, 20);
    case "confidence": return null;
    default: return num(c.points, 1);
  }
}

/** Points, minutes and counts for a round. `settings` gives the trivia's default time per question. */
export function roundSummary(round, settings) {
  const def = num(settings?.timeLimit, 180);
  let points = 0, open = false, seconds = 0, untimed = 0;
  for (const m of round.modules) {
    const p = maxPoints(m);
    if (p === null && m.type !== "confidence") open = true;
    else if (p !== null) points += p;
    const t = num(m.timeLimit, def);
    if (t === 0) untimed++;
    seconds += t === 0 ? 120 : t; // an untimed question is guessed at two minutes
    seconds += 60; // closing, marking and revealing
    if (m.type === "jeopardy") seconds += 60; // the wager step
  }
  for (const s of confidenceSets(round)) {
    const values = (round.modules[s.start].config?.poolValues ?? []).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
    points += values.slice(0, s.end - s.start + 1).reduce((a, b) => a + b, 0);
  }
  if (round.modules.length) seconds += 120; // the scoreboard after the round
  return { count: round.modules.length, points, open, minutes: Math.round(seconds / 60), untimed };
}

const unit = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const formatMinutes = (min) => (min < 60 ? unit(min, "minute") : `${unit(Math.floor(min / 60), "hour")}${min % 60 ? ` and ${unit(min % 60, "minute")}` : ""}`);

const SWAPS = [
  [/^(the|a|an)\s+(.+)$/i, (_m, _a, rest) => rest],
  [/\s&\s/, (s) => s.replace(/\s&\s/g, " and ")],
  [/^st\.?\s/i, (s) => s.replace(/^st\.?\s/i, "Saint ")],
  [/^saint\s/i, (s) => s.replace(/^saint\s/i, "St ")],
  [/^mt\.?\s/i, (s) => s.replace(/^mt\.?\s/i, "Mount ")],
  [/^mount\s/i, (s) => s.replace(/^mount\s/i, "Mt ")],
  [/^dr\.?\s/i, (s) => s.replace(/^dr\.?\s/i, "Doctor ")],
];
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];

/**
 * Other ways a team might type a right answer that the forgiving match would still miss, not yet in the list:
 * without a leading "The", "and" for "&", Saint/St, Mount/Mt, Doctor/Dr, and small numbers as words or digits.
 * Capitals, accents, punctuation and hyphens are already forgiven, so they are never suggested.
 */
export function alsoAccept(answers) {
  const have = new Set(lines(answers).map(normalize));
  const out = [];
  const offer = (s) => { const t = text(s); if (t && /[\p{L}\p{N}]/u.test(t) && !have.has(normalize(t))) { have.add(normalize(t)); out.push(t); } };
  for (const a of lines(answers)) {
    for (const [re, fix] of SWAPS) if (re.test(a)) offer(a.replace(re, fix));
    const n = normalize(a);
    if (/^\d+$/.test(n) && Number(n) <= 20) offer(WORDS[Number(n)]);
    else if (WORDS.includes(n)) offer(String(WORDS.indexOf(n)));
  }
  return out;
}

/** The first line of a question, for naming it in a list. */
const firstLine = (m) => text(m.config?.question).split("\n")[0].slice(0, 60) || "(no question yet)";

/**
 * Everything worth knowing before hosting this trivia for the first time.
 * `facts`: what the night will be like. `rules`: how scoring will behave, given what this trivia uses.
 * `warnings`: things to fix or check, each with the question it is about ({ r, i }) when there is one.
 */
export function readiness(state) {
  const settings = state.settings ?? {};
  const rounds = state.rounds ?? [];
  const all = rounds.flatMap((r, ri) => r.modules.map((m, i) => ({ m, r: ri, i })));
  const types = new Set(all.map((x) => x.m.type));
  const sums = rounds.map((r) => roundSummary(r, settings));
  const total = all.length;
  const minutes = sums.reduce((a, s) => a + s.minutes, 0);
  const points = sums.reduce((a, s) => a + s.points, 0);
  const open = sums.some((s) => s.open);
  const theme = settings.theme;
  const themeOn = !!(theme && text(theme.secret));
  const bonus = themeOn ? num(theme.bonus, 4) : 0;
  const guesses = num(settings.maxGuesses, 3);
  const time = num(settings.timeLimit, 180);

  const facts = [
    `This trivia has ${total} question${total === 1 ? "" : "s"} in ${rounds.length} round${rounds.length === 1 ? "" : "s"}.`,
    total ? `It should take about ${formatMinutes(minutes)} from the first question to the final scores. That counts the time to answer, about a minute per question for you to close, mark and reveal it, and the scoreboard after each round.` : null,
    total ? `A team can score at most ${points + bonus} points${bonus ? ` (${bonus} of them for the secret theme)` : ""}${open ? ", plus whatever it wins on wagers" : ""}.` : null,
    time === 0 ? "There is no timer, so each question stays open until you close it." : `Each question is open for ${time >= 60 ? formatMinutes(Math.round(time / 60)) : `${time} seconds`} unless you close it sooner or a question has its own time.`,
    guesses === 0 ? "Teams can change their answers as often as they like, up to 20 times per question." : `Each team gets ${guesses} guess${guesses === 1 ? "" : "es"} per question, ${guesses === 1 ? "so an answer can't be changed once it is sent" : `which means its first answer plus ${guesses - 1} change${guesses === 2 ? "" : "s"}`}. All the phones of a team share the same guesses.`,
  ].filter(Boolean);

  const rules = [
    rounds.length <= 1
      ? "There is only one round, so teams see no scoreboard until the very end."
      : `Teams see the scoreboard only after each round (${rounds.length} times), never in the middle of one.`,
    "Points are banked when you press Next question. Until then you can change any mark, and Right, Half and Wrong are always there.",
    "Players never see whether an answer is right until you reveal it.",
    themeOn ? (rounds.length > 1
      ? `The secret theme goes public when round 2 ("${text(rounds[1].title)}") starts, or earlier if every team has found it. Players can guess it until then.`
      : "The secret theme goes public at the end of the game, since there is only one round.") : null,
    themeOn ? "Theme bonuses are hidden and left out of every scoreboard until the theme goes public." : null,
    types.has("confidence") ? "In a confidence set, a team uses up a value once the question finishes, even if its answer was wrong. If a team skips a question, it keeps the value." : null,
    types.has("wager") ? "In the final wager, a wrong answer loses the amount wagered, so scores can go down." : null,
    types.has("jeopardy") ? "In Final Jeopardy, teams wager after seeing only the category, and you press Show the question when you are ready. Scores can go down." : null,
    all.some((x) => x.m.type === "jeopardy" && x.m.config?.silentLoses !== false) ? "In Final Jeopardy, a team that wagers and then sends no answer loses its wager." : null,
    all.some((x) => (x.m.type === "jeopardy" || x.m.type === "wager") && x.m.config?.capByScore) ? "A wager capped by score shows each team its own score just before the round-end scoreboard." : null,
    types.has("numeric_closest") ? "In a closest-number question, the closest guess wins the points and tied teams share them. Nobody knows who won until you reveal the answer." : null,
    types.has("nsome") ? "In an N-some, each right item scores, and a team that gets them all earns the bonus too. The order doesn't matter, and an item typed twice counts once." : null,
    all.some((x) => x.m.type === "nsome" && x.m.config?.catchall) ? "The extra box on an N-some never scores by itself. Read it, and award points by hand if you feel generous." : null,
  ].filter(Boolean);

  const warnings = [];
  const warn = (text, at) => warnings.push({ text, ...(at ? { at } : {}) });
  if (!total) warn("There are no questions yet.");
  if (total > 50) warn(`${total} questions is a long night: over 50 tires players out.`);
  rounds.forEach((r, ri) => { if (!r.modules.length) warn(`Round ${ri + 1} ("${text(r.title)}") has no questions. Remove it or add some.`); });
  if (theme && !text(theme.secret)) warn("The secret theme is ticked but empty, so it will not be saved. Fill it in or untick it.");
  if (themeOn && !text(theme.hint)) warn("The secret theme has no hint. Players see only \"Don't forget the secret theme!\" until it goes public.");
  if (themeOn && !text(theme.formal)) warn("The secret theme has no explanation to show when it is revealed.");

  for (const { m, r, i } of all) {
    const at = { r, i };
    const c = m.config ?? {};
    const name = `Round ${r + 1}, question ${i + 1}`;
    if (isBlank(m)) { warn(`${name} is empty: fill it in or remove it before saving.`, at); continue; }
    if (!text(c.question)) warn(`${name} has no question text.`, at);
    if (text(c.question).length > 500) warn(`${name} ("${firstLine(m)}…") is long (${text(c.question).length} characters). The TV shrinks it to fit, so preview it to check it is still readable.`, at);
    if (TYPED.has(m.type) || m.type === "nsome") {
      if (!lines(c.answers).length) warn(`${name} ("${firstLine(m)}") has no accepted answer.`, at);
      else if (TYPED.has(m.type) && alsoAccept(c.answers).length) warn(`${name} ("${firstLine(m)}"): a right answer could be typed in a way that shows as "no match". Open it to add other spellings with one click.`, at);
    }
    if (m.type === "nsome" && lines(c.answers).length && lines(c.answers).length < num(c.count, 3)) warn(`${name} asks for ${num(c.count, 3)} things but accepts only ${lines(c.answers).length}, so nobody can get them all.`, at);
    if (m.type === "multiple_choice") {
      const opts = lines(c.options);
      if (opts.length < 2) warn(`${name} needs at least 2 options.`, at);
      if (new Set(opts.map(normalize)).size < opts.length) warn(`${name} has two options that read the same.`, at);
      if (num(c.correct, 0) >= opts.length && opts.length) warn(`${name} has no correct option picked.`, at);
    }
    if (m.type === "jeopardy" && !text(c.category)) warn(`${name} (Final Jeopardy) has no category: that is all teams see while they wager.`, at);
  }
  rounds.forEach((round, r) => {
    for (const s of confidenceSets(round)) {
      const n = s.end - s.start + 1;
      const v = (round.modules[s.start].config?.poolValues ?? []).map(Number).filter(Number.isFinite).length;
      const at = { r, i: s.start };
      if (n === 1) warn(`Round ${r + 1}, question ${s.start + 1}: a confidence set with only one question gives nothing to choose between.`, at);
      else if (n > v) warn(`Round ${r + 1}, question ${s.start + 1}: this confidence set has ${n} questions but ${v} values, so the last ${n - v} can't bet anything.`, at);
    }
  });
  return { facts, rules, warnings, minutes, points: points + bonus, total };
}
