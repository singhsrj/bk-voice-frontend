import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";
import { cookies, headers } from "next/headers";
import {
  GUESTS_ENABLED,
  checkOrderQuota,
  type Requester,
} from "@/lib/rateLimit";

// Never cache: every visit needs a fresh room and token.
export const dynamic = "force-dynamic";

const GUEST_COOKIE = "bk_guest";
const UUID_LIKE = /^[0-9a-f-]{36}$/i;

// Guests get a random id stored in an httpOnly cookie. It is not a strong
// identity (clearing cookies gives a new one), so the per-IP and all-guests
// limits in lib/rateLimit.ts do the real protecting.
async function identifyGuest(): Promise<{ guestId: string; ip: string }> {
  const jar = await cookies();
  const existing = jar.get(GUEST_COOKIE)?.value;
  const guestId = existing && UUID_LIKE.test(existing) ? existing : randomUUID();

  // Always (re)set it, even if this request ends up refused, so a guest who
  // hit their limit keeps the same id instead of getting a fresh one.
  jar.set(GUEST_COOKIE, guestId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });

  const h = await headers();
  const ip =
    h.get("x-nf-client-connection-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";

  return { guestId, ip };
}

export async function POST() {
  // 1. Signed-in users are identified by Clerk; everyone else is a guest.
  const { userId } = await auth();

  let requester: Requester;
  let identity: string;
  const id = randomUUID().slice(0, 8);

  if (userId) {
    requester = { kind: "user", userId };
    identity = `${userId}-${id}`;
  } else {
    if (!GUESTS_ENABLED) {
      return Response.json(
        { error: "unauthorized", message: "Sign in to start ordering." },
        { status: 401 },
      );
    }
    const guest = await identifyGuest();
    requester = { kind: "guest", ...guest };
    identity = `guest-${guest.guestId.slice(0, 8)}-${id}`;
  }

  // 2. Check configuration before spending any daily quota.
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) {
    return Response.json(
      { error: "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set." },
      { status: 500 },
    );
  }

  // 3. Daily limits. Fail closed if the limiter itself is unreachable, so an
  //    outage can't open the gate.
  try {
    const quota = await checkOrderQuota(requester);
    if (!quota.ok) {
      return Response.json(
        { error: quota.code, message: quota.message },
        { status: 429 },
      );
    }
  } catch (e) {
    console.error("Rate limit check failed", e);
    return Response.json(
      {
        error: "limit_check_failed",
        message: "Couldn't check your daily limit. Try again in a moment.",
      },
      { status: 503 },
    );
  }

  // 4. Issue the token. One room per order, so customers never hear each other.
  const token = new AccessToken(apiKey, apiSecret, { identity, ttl: "10m" });
  token.addGrant({
    room: `order-${id}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  // With automatic dispatch (no agent_name in agent.py) nothing else is needed.
  const agentName = process.env.AGENT_NAME;
  if (agentName) {
    token.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName })],
    });
  }

  return Response.json(
    { serverUrl, token: await token.toJwt() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
