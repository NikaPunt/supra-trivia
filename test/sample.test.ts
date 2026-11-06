import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { signSession } from "../src/auth.js";
import { HostDirectory } from "../src/hosts.js";
import { openDb } from "../src/db.js";
import { buildApp } from "../src/app.js";
import { loadSample } from "../src/sample.js";
import { getModule } from "../src/modules/index.js";
import { act, hostView, items, joinPlayer, newGame, playerView, submit, submitTheme } from "../src/game.js";

const env = { BASE_URL: "https://t.example.com", SESSION_SECRET: "x".repeat(40), GOOGLE_CLIENT_ID: "i", GOOGLE_CLIENT_SECRET: "s" };
const hosts = HostDirectory.fromLists({ admins: ["owner@example.com"], hosts: ["a@example.com", "b@example.com"] });

test("the sample is a valid trivia: the Spooky OOs night, 29 questions, a secret theme", () => {
  const s = loadSample()!;
  assert.ok(s, "it loads");
  assert.equal(s.title, "Spooky OOs (sample)");
  const all = s.rounds.flatMap((r) => r.modules);
  assert.equal(all.length, 29);
  assert.equal(s.rounds.length, 2);
  assert.ok(s.settings.theme?.secret.includes("OO"));
  const sections = [...new Set(all.map((m) => m.section))];
  assert.deepEqual(sections, ["Hodgepodge", "Before & After", "Three Actors and a Year", "Confidence Set", "Vanna", "Who Charted?", "Final Wager"]);
  const text = JSON.stringify(s);
  assert.ok(!/\bRIP\b|not dead just not here/i.test(text), "the private in-joke from the original is not in the sample everyone gets");
});

test("nothing a player needs was left behind when the questions were converted", () => {
  const all = loadSample()!.rounds.flatMap((r) => r.modules.map((m) => ({ m, q: (m.config as any).question as string })));
  const find = (re: RegExp) => all.find((x) => re.test(x.q))!;
  assert.match(find(/Scooby|Gellar/).q, /Sarah Michelle Gellar, Matthew Lillard and Linda Cardellini\. Released in 2002/, "actors and year");
  assert.match(find(/_ _ S H/).q, /_ _ S H _ O O _ \/ _ _ S O _ _ O/, "puzzle letters");
  assert.match(find(/Doobie|Listen to the Music/).q, /"Listen to the Music", "Black Water", "What a Fool Believes"/, "the track list");
  assert.match(find(/calculator humor/).q, /1\. Multiply HELL[\s\S]*4\. Subtract a LEET/, "the numbered calculator steps");
  assert.match(find(/Fussball|ball, sticks/).q, /^Category: Games/, "confidence questions lead with their category");
  for (const { q } of all) {
    const paras = q.split(/\n+/);
    assert.ok(paras.length >= 2 && /\?|:$/.test(paras.at(-1)!.trim()), `ends with its ask on its own line: ${q.slice(0, 40)}`);
  }
});

test("every question accepts its own listed answer and nothing is graded wrong by its own spelling", () => {
  for (const r of loadSample()!.rounds) for (const m of r.modules) {
    const mod = getModule(m.type)!;
    const c = m.config as any;
    const ans = { text: c.answers[0], bet: c.poolValues?.[0], wager: c.maxWager };
    assert.ok(mod.score(c, ans) > 0, `${m.type} accepts "${c.answers[0]}"`);
    assert.equal(new Set(c.answers.map((a: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())).size, c.answers.length, "no answers that differ only by case");
  }
});

test("the whole sample can be played from lobby to final scoreboard", () => {
  const s = loadSample()!;
  const g = newGame({ hostEmail: "h@example.com", triviaId: "t", title: s.title, rounds: s.rounds, code: "ABCDE", maxGuesses: s.settings.maxGuesses, timeLimit: s.settings.timeLimit, theme: s.settings.theme });
  const ann = joinPlayer(g, "Ann").player, bob = joinPlayer(g, "Bob").player;
  act(g, { action: "begin" });
  const headers: string[] = [];
  const spent = { ann: new Map<string, number>() };
  for (let i = 0; i < items(g).length; i++) {
    const v = hostView(g).item!;
    headers.push(`${v.round}: ${v.section} ${v.pos.n}/${v.pos.of}`);
    const c = items(g)[i]!.config as any;
    const mod = getModule(items(g)[i]!.type)!;
    // Ann answers correctly, staking the best value she has left; Bob answers wrongly with the smallest stake.
    const pa = playerView(g, ann.id).stake, pb = playerView(g, bob.id).stake;
    const stake = (st: typeof pa, pick: "best" | "least") => (st?.options ? (pick === "best" ? Math.max(...st.options) : Math.min(...st.options)) : st ? (pick === "best" ? st.max : 0) : undefined);
    const mk = (text: string, st: typeof pa, pick: "best" | "least") => ({ text, ...(st ? { [st.key]: stake(st, pick) } : {}) });
    submit(g, ann.id, mk(c.answers[0], pa, "best"));
    submit(g, bob.id, mk("definitely wrong", pb, "least"));
    if (i === 3) { submitTheme(g, ann.id, "double o"); submitTheme(g, bob.id, "words with oo"); }
    act(g, { action: "close" });
    act(g, { action: "reveal" });
    const hv = hostView(g);
    assert.ok(hv.answers.find((a) => a.nickname === "Ann")!.points > 0, `Ann is right on question ${i + 1} (${mod.label})`);
    assert.ok(hv.answers.find((a) => a.nickname === "Bob")!.points <= 0, `Bob is wrong on question ${i + 1}`);
    act(g, { action: "next" });
  }
  assert.equal(g.phase, "ended");
  assert.equal(headers[0], "Round 1: Hodgepodge 1/6");
  assert.ok(headers.includes("Round 1: Before & After 2/2") && headers.includes("Round 1: Three Actors and a Year 1/2") && headers.includes("Round 2: Vanna 2/2") && headers.includes("Round 2: Who Charted? 1/2") && headers.includes("Round 2: Final Wager 1/1"));
  assert.equal(headers.filter((h) => h.startsWith("Round 1: Confidence Set")).length, 4);
  const board = hostView(g).leaderboard;
  assert.equal(board[0]!.nickname, "Ann");
  assert.ok(board[0]!.points > board[1]!.points);
  assert.ok(playerView(g, bob.id).theme?.revealed, "the theme was public by the end");
});

test("a host gets the sample once, in their own list, and it does not return after deleting it", async () => {
  const app = await buildApp(loadConfig(env), openDb(":memory:"), hosts);
  const cfg = loadConfig(env);
  const as = async (email: string) => ({ cookie: "trivia_session=" + (await signSession(cfg, { email, name: email })), origin: cfg.BASE_URL });
  const list = async (h: object, q = "") => (await app.inject({ url: "/api/trivias" + q, headers: h as any })).json() as { id: string; title: string; owner: string }[];
  const a = await as("a@example.com"), b = await as("b@example.com"), owner = await as("owner@example.com");

  assert.deepEqual((await list(a)).map((t) => t.title), ["Spooky OOs (sample)"], "the first time a host opens their list, the sample is there");
  assert.equal((await list(a)).length, 1, "and it is added once, not on every visit");
  const mine = (await list(a))[0]!;
  const full = (await app.inject({ url: `/api/trivias/${mine.id}`, headers: a })).json();
  assert.equal(full.rounds.flatMap((r: any) => r.modules).length, 29);
  assert.ok(full.settings.theme.secret.includes("OO"));

  // It is theirs: edit it, delete it, and it stays gone.
  assert.equal((await app.inject({ method: "PUT", url: `/api/trivias/${mine.id}`, headers: a, payload: { title: "Our night", settings: full.settings, rounds: full.rounds.slice(0, 1) } })).statusCode, 200);
  assert.equal((await list(a))[0]!.title, "Our night");
  assert.equal((await app.inject({ method: "DELETE", url: `/api/trivias/${mine.id}`, headers: a })).statusCode, 200);
  assert.deepEqual(await list(a), [], "deleted for good");

  // Everyone else gets their own, and editing one never touches another's.
  const bList = await list(b);
  assert.equal(bList.length, 1);
  assert.equal(bList[0]!.title, "Spooky OOs (sample)");
  assert.equal(bList[0]!.owner, "b@example.com");
  assert.notEqual(bList[0]!.id, mine.id);

  // Looking at everything as admin does not use up the admin's own copy.
  assert.equal((await list(owner, "?all=1")).length, 1, "an admin's overview shows others' trivias only");
  assert.deepEqual((await list(owner)).map((t) => t.title), ["Spooky OOs (sample)"], "the admin's own list then gets theirs");
  await app.close();
});

test("the sample can be switched off for a deployment that does not want it", async () => {
  const cfg = loadConfig({ ...env, SEED_SAMPLE: "false" });
  const app = await buildApp(cfg, openDb(":memory:"), hosts);
  const h = { cookie: "trivia_session=" + (await signSession(cfg, { email: "a@example.com", name: "a" })), origin: cfg.BASE_URL };
  assert.deepEqual((await app.inject({ url: "/api/trivias", headers: h })).json(), []);
  await app.close();
});
