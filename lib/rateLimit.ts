import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Each call to /api/token starts one voice session, and every session spends
// STT, LLM and TTS credits. These caps bound how many sessions can start.
// All of them reset at 00:00 UTC.
//
// Signed-in users
//   SESSIONS_PER_USER_PER_DAY            per user               (default 5)
// Guests
//   GUEST_SESSIONS_PER_DAY               per guest cookie       (default 2)
//   GUEST_SESSIONS_PER_IP_PER_DAY        per network address    (default 5)
//   GUEST_SESSIONS_PER_DAY_ALL_GUESTS    all guests together    (default 20)
// Everyone
//   SESSIONS_PER_DAY_ALL_USERS           guests + users         (default 50)
//
// A guest cookie is easy to clear, so it only stops casual repeat use. The
// per-IP and all-guests caps are what actually protect your credits.

function intFromEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const USER_LIMIT = intFromEnv("SESSIONS_PER_USER_PER_DAY", 5);
const GLOBAL_LIMIT = intFromEnv("SESSIONS_PER_DAY_ALL_USERS", 50);
const GUEST_LIMIT = intFromEnv("GUEST_SESSIONS_PER_DAY", 2);
const IP_LIMIT = intFromEnv("GUEST_SESSIONS_PER_IP_PER_DAY", 5);
const GUEST_GLOBAL_LIMIT = intFromEnv("GUEST_SESSIONS_PER_DAY_ALL_GUESTS", 20);

// Set GUESTS_ENABLED=false to switch guest ordering off (sign-in only).
export const GUESTS_ENABLED = process.env.GUESTS_ENABLED !== "false";

// Clerk user ids (user_...) that skip the limits, e.g. yours while testing.
const EXEMPT = new Set(
  (process.env.RATE_LIMIT_EXEMPT_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

type Verdict = { success: boolean; reset: number };
type Limiter = { limit(key: string): Promise<Verdict> };

const DAY_MS = 24 * 60 * 60 * 1000;

// Local-dev fallback. State lives in one server process only, so it is NOT
// shared between serverless instances. Use Upstash for anything deployed.
type Bucket = { count: number; reset: number };
const memoryStore: Map<string, Bucket> =
  ((globalThis as Record<string, unknown>).__bkLimits as Map<string, Bucket>) ??
  new Map();
(globalThis as Record<string, unknown>).__bkLimits = memoryStore;

function memoryLimiter(max: number, prefix: string): Limiter {
  return {
    async limit(key) {
      const id = `${prefix}:${key}`;
      const now = Date.now();
      let bucket = memoryStore.get(id);
      if (!bucket || bucket.reset <= now) {
        bucket = { count: 0, reset: (Math.floor(now / DAY_MS) + 1) * DAY_MS };
        memoryStore.set(id, bucket);
      }
      bucket.count += 1;
      return { success: bucket.count <= max, reset: bucket.reset };
    },
  };
}

const hasUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

if (!hasUpstash) {
  console.warn(
    "[rate-limit] UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. " +
      "Using in-memory limits, which are not shared between serverless instances. " +
      "Set them before deploying.",
  );
}

function makeLimiter(max: number, name: string): Limiter {
  if (!hasUpstash) return memoryLimiter(max, name);
  return new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(max, "1 d"),
    prefix: `bk:${name}`,
  });
}

const userLimiter = makeLimiter(USER_LIMIT, "user");
const guestLimiter = makeLimiter(GUEST_LIMIT, "guest");
const ipLimiter = makeLimiter(IP_LIMIT, "ip");
const guestGlobalLimiter = makeLimiter(GUEST_GLOBAL_LIMIT, "guests-all");
const globalLimiter = makeLimiter(GLOBAL_LIMIT, "global");

function waitText(resetMs: number): string {
  const minutes = Math.max(1, Math.ceil((resetMs - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export type Requester =
  | { kind: "user"; userId: string }
  | { kind: "guest"; guestId: string; ip: string };

export type QuotaResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

const deny = (code: string, message: string): QuotaResult => ({
  ok: false,
  code,
  message,
});

export async function checkOrderQuota(who: Requester): Promise<QuotaResult> {
  if (who.kind === "user") {
    if (EXEMPT.has(who.userId)) return { ok: true };

    const user = await userLimiter.limit(who.userId);
    if (!user.success) {
      return deny(
        "user_limit",
        `You've used all ${USER_LIMIT} orders for today. Try again in ${waitText(user.reset)}.`,
      );
    }
  } else {
    const guest = await guestLimiter.limit(who.guestId);
    if (!guest.success) {
      return deny(
        "guest_limit",
        `You've used your ${GUEST_LIMIT} guest order${GUEST_LIMIT === 1 ? "" : "s"} for today. Sign in to get more, or try again in ${waitText(guest.reset)}.`,
      );
    }

    const ip = await ipLimiter.limit(who.ip);
    if (!ip.success) {
      return deny(
        "ip_limit",
        `There have been too many guest orders from this network today. Sign in to continue, or try again in ${waitText(ip.reset)}.`,
      );
    }

    const allGuests = await guestGlobalLimiter.limit("all");
    if (!allGuests.success) {
      return deny(
        "guest_capacity",
        `Guest ordering has reached its daily limit. Sign in to continue, or try again in ${waitText(allGuests.reset)}.`,
      );
    }
  }

  const everyone = await globalLimiter.limit("all");
  if (!everyone.success) {
    return deny(
      "global_limit",
      `The ordering assistant has reached its daily limit. Try again in ${waitText(everyone.reset)}.`,
    );
  }

  return { ok: true };
}
