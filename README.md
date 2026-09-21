# BK voice order frontend

Next.js frontend for the LiveKit BK voice agent. Customers order as a guest or sign in with Clerk, the browser joins a LiveKit room, the deployed agent joins the same room, and the receipt arrives on the `bk-order-receipt` topic.

## Run it

```
npm install
cp .env.local.example .env.local   # fill in LiveKit + Clerk values
npm run dev
```

Open http://localhost:3000, sign in, click **Start ordering**, and allow the microphone.

## How it fits together

- `middleware.ts` runs Clerk so route handlers can read the signed-in user.
- `app/api/token/route.ts` identifies the caller (Clerk user or guest cookie), checks the daily limits, then creates a fresh room and a 10-minute LiveKit token. The API secret never reaches the browser.
- `lib/rateLimit.ts` enforces the daily caps for users, guests, IPs and everyone combined. It uses Upstash Redis when configured and an in-memory fallback otherwise.
- `lib/useVoiceOrder.ts` connects to the room, plays the agent's voice, shows live captions, and reads the receipt.
- `components/Receipt.tsx` renders the receipt when `place_order` runs in `agent.py`.

## Guests and limits

Visitors can order as a guest or sign in with Clerk. Guests get a random id in an httpOnly cookie, and every session start is checked against daily limits:

| Who | Limit | Env var (default) |
| --- | --- | --- |
| Signed-in user | per user | `SESSIONS_PER_USER_PER_DAY` (5) |
| Guest | per cookie | `GUEST_SESSIONS_PER_DAY` (2) |
| Guest | per IP address | `GUEST_SESSIONS_PER_IP_PER_DAY` (5) |
| All guests | combined | `GUEST_SESSIONS_PER_DAY_ALL_GUESTS` (20) |
| Everyone | combined | `SESSIONS_PER_DAY_ALL_USERS` (50) |

A cookie is easy to clear, so the per-cookie limit only stops casual repeat use. The per-IP and all-guests caps are the real protection. Set `GUESTS_ENABLED=false` to require sign-in again, for example when credits are running low.

## Protecting your credits

The limits cap how many sessions can START. To cap how long each one RUNS, add a maximum call length to `agent.py`. Worst case per day is roughly `SESSIONS_PER_DAY_ALL_USERS x MAX_SESSION_SECONDS`.

Per-user limits only help if people can't create unlimited accounts. In the Clerk dashboard, restrict sign-ups (Google-only sign-in, block disposable emails and email subaddresses, or use an allowlist).

## Notes

- The agent must use automatic dispatch (no `agent_name` in `agent.py`), or set `AGENT_NAME` in `.env.local` to the same name.
- Browsers only allow the microphone on `https://` or `localhost`.
- On Next.js 16, rename `middleware.ts` to `proxy.ts`.
- Clerk production keys need a domain you own. On a `*.netlify.app` URL, use the development keys (capped at 100 users, with a development banner).
