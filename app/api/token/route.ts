import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";
import { checkOrderQuota } from "@/lib/rateLimit";

// Never cache: every visit needs a fresh room and token.
export const dynamic = "force-dynamic";

export async function POST() {
  // 1. Only signed-in users get a token.
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: "unauthorized", message: "Sign in to start ordering." },
      { status: 401 },
    );
  }
console.log(
  "clerk key check:",
  process.env.CLERK_SECRET_KEY?.slice(0, 8),
  process.env.CLERK_SECRET_KEY?.length,
);
  // 2. Check configuration before spending any of the user's daily quota.
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!serverUrl || !apiKey || !apiSecret) {
    return Response.json(
      { error: "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set." },
      { status: 500 },
    );
  }

  // 3. Daily limits, per user and across all users. Fail closed if the
  //    limiter itself is unreachable, so an outage can't open the gate.
  try {
    const quota = await checkOrderQuota(userId);
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
  const id = randomUUID().slice(0, 8);
  const token = new AccessToken(apiKey, apiSecret, {
    // The Clerk user id makes each session traceable to a user in LiveKit.
    identity: `${userId}-${id}`,
    ttl: "10m",
  });
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
