import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import { createHash, randomBytes } from "node:crypto";
import type { Config } from "./config.js";
import type { HostDirectory, Role } from "./hosts.js";

export const SESSION_COOKIE = "trivia_session";
export const LOGIN_COOKIE = "trivia_login";
const SESSION_TTL_S = 8 * 3600;
const LOGIN_TTL_S = 10 * 60;
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

const key = (cfg: Config) => new TextEncoder().encode(cfg.SESSION_SECRET);
const b64url = (b: Buffer) => b.toString("base64url");

export interface Session {
  email: string;
  name: string;
  /** Always taken from the hosts file, never from the token. */
  role: Role;
}

export async function signSession(cfg: Config, s: Pick<Session, "email" | "name">): Promise<string> {
  return new SignJWT({ name: s.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.email)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(key(cfg));
}

/** Returns the session only if the signature and expiry are valid and the email is still in the hosts file. */
export async function verifySession(cfg: Config, hosts: HostDirectory, token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(cfg), { algorithms: ["HS256"] });
    const role = payload.sub ? hosts.roleOf(payload.sub) : null;
    if (!payload.sub || !role) return null;
    return { email: payload.sub, name: String(payload.name ?? payload.sub), role };
  } catch {
    return null;
  }
}

interface LoginState {
  state: string;
  nonce: string;
  verifier: string;
}

export async function startLogin(cfg: Config) {
  const login: LoginState = {
    state: b64url(randomBytes(24)),
    nonce: b64url(randomBytes(24)),
    verifier: b64url(randomBytes(48)),
  };
  const cookie = await new SignJWT({ ...login })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${LOGIN_TTL_S}s`)
    .sign(key(cfg));
  const url = new URL(GOOGLE_AUTH);
  url.search = new URLSearchParams({
    client_id: cfg.GOOGLE_CLIENT_ID,
    redirect_uri: `${cfg.BASE_URL}/auth/callback`,
    response_type: "code",
    scope: "openid email profile",
    state: login.state,
    nonce: login.nonce,
    code_challenge: b64url(createHash("sha256").update(login.verifier).digest()),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie, maxAge: LOGIN_TTL_S };
}

export class LoginError extends Error {}

export async function finishLogin(
  cfg: Config,
  hosts: HostDirectory,
  loginCookie: string | undefined,
  query: { code?: string; state?: string },
): Promise<Session> {
  if (!loginCookie || !query.code || !query.state) throw new LoginError("missing login state");
  let login: LoginState;
  try {
    const { payload } = await jwtVerify(loginCookie, key(cfg), { algorithms: ["HS256"] });
    login = payload as unknown as LoginState;
  } catch {
    throw new LoginError("login expired");
  }
  if (login.state !== query.state) throw new LoginError("state mismatch");

  const res = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: query.code,
      client_id: cfg.GOOGLE_CLIENT_ID,
      client_secret: cfg.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${cfg.BASE_URL}/auth/callback`,
      grant_type: "authorization_code",
      code_verifier: login.verifier,
    }),
  });
  if (!res.ok) throw new LoginError("token exchange failed");
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new LoginError("no id_token");

  const { payload } = await jwtVerify(id_token, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: cfg.GOOGLE_CLIENT_ID,
  });
  if (payload.nonce !== login.nonce) throw new LoginError("nonce mismatch");
  const email = String(payload.email ?? "").toLowerCase();
  if (payload.email_verified !== true || !email) throw new LoginError("email not verified");
  const role = hosts.roleOf(email);
  if (!role) throw new LoginError("not on the host allowlist");
  return { email, name: String(payload.name ?? email), role };
}

export const PLAYER_COOKIE = "trivia_player";
const PLAYER_TTL_S = 12 * 3600;

export interface PlayerToken {
  sid: string;
  pid: string;
}

export async function signPlayer(cfg: Config, t: PlayerToken): Promise<string> {
  return new SignJWT({ sid: t.sid, pid: t.pid })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience("player")
    .setExpirationTime(`${PLAYER_TTL_S}s`)
    .sign(key(cfg));
}

export async function verifyPlayer(cfg: Config, token: string | undefined): Promise<PlayerToken | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(cfg), { algorithms: ["HS256"], audience: "player" });
    return { sid: String(payload.sid), pid: String(payload.pid) };
  } catch {
    return null;
  }
}
export const PLAYER_MAX_AGE = PLAYER_TTL_S;
