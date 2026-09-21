# BK voice order frontend

Next.js frontend for the LiveKit BK voice agent. The browser joins a LiveKit room, the deployed agent joins the same room, and the receipt arrives on the `bk-order-receipt` topic.

## Run it

```
npm install
cp .env.local.example .env.local   # then fill in the three LIVEKIT_ values
npm run dev
```

Open http://localhost:3000, click **Start ordering**, and allow the microphone.

## How it fits together

- `app/api/token/route.ts` creates a fresh room and a 10-minute token on the server. The API secret never reaches the browser.
- `lib/useVoiceOrder.ts` connects to the room, plays the agent's voice, shows live captions, tracks the agent state, and reads the receipt.
- `components/Receipt.tsx` renders the receipt when `place_order` runs in `agent.py`.

## Notes

- The agent must use automatic dispatch (no `agent_name` in `agent.py`), or set `AGENT_NAME` in `.env.local` to the same name.
- Browsers only allow the microphone on `https://` or `localhost`.
- The token route is open to anyone who can reach it. Before going public, add rate limiting or a login, because every visit starts a paid agent session.
