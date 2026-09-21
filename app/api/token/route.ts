import { randomUUID } from "node:crypto";
import { RoomAgentDispatch, RoomConfiguration } from "@livekit/protocol";
import { AccessToken } from "livekit-server-sdk";

// Never cache: every visit needs a fresh room and token.
export const dynamic = "force-dynamic";

export async function POST() {
  const serverUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!serverUrl || !apiKey || !apiSecret) {
    return Response.json(
      { error: "LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be set." },
      { status: 500 },
    );
  }

  // One room per order, so two customers never hear each other.
  const id = randomUUID().slice(0, 8);
  const token = new AccessToken(apiKey, apiSecret, {
    identity: `customer-${id}`,
    ttl: "10m",
  });
  token.addGrant({
    room: `order-${id}`,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
  });

  // With automatic dispatch (no agent_name in agent.py) nothing else is needed.
  // If you name the agent, ask for it explicitly when the room is created.
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
