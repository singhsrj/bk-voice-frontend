import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

// Each call to /api/token starts one voice session, and every session spends
// STT, LLM and TTS credits. These two caps bound how many sessions can start.
//   SESSIONS_PER_USER_PER_DAY     per signed-in user (default 5)
//   SESSIONS_PER_DAY_ALL_USERS    across everyone     (default 50)
// Both reset at 00:00 UTC.

function intFromEnv(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const USER_LIMIT = intFromEnv("SESSIONS_PER_USER_PER_DAY", 5);
const GLOBAL_LIMIT = intFromEnv("SESSIONS_PER_DAY_ALL_USERS", 50);

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

function upstashLimiter(max: number, prefix: string): Limiter {
  return new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.fixedWindow(max, "1 d"),
    prefix,
  });
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

const userLimiter = hasUpstash
  ? upstashLimiter(USER_LIMIT, "bk:user")
  : memoryLimiter(USER_LIMIT, "user");
const globalLimiter = hasUpstash
  ? upstashLimiter(GLOBAL_LIMIT, "bk:global")
  : memoryLimiter(GLOBAL_LIMIT, "global");

function waitText(resetMs: number): string {
  const minutes = Math.max(1, Math.ceil((resetMs - Date.now()) / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export type QuotaResult =
  | { ok: true }
  | { ok: false; code: "user_limit" | "global_limit"; message: string };

export async function checkOrderQuota(userId: string): Promise<QuotaResult> {
  if (EXEMPT.has(userId)) return { ok: true };

  const user = await userLimiter.limit(userId);
  if (!user.success) {
    return {
      ok: false,
      code: "user_limit",
      message: `You've used all ${USER_LIMIT} orders for today. Try again in ${waitText(user.reset)}.`,
    };
  }

  const everyone = await globalLimiter.limit("all");
  if (!everyone.success) {
    return {
      ok: false,
      code: "global_limit",
      message: `The ordering assistant has reached its daily limit. Try again in ${waitText(everyone.reset)}.`,
    };
  }

  return { ok: true };
}
