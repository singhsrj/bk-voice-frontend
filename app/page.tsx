"use client";

import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { Receipt } from "@/components/Receipt";
import {
  useVoiceOrder,
  type AgentState,
  type Phase,
} from "@/lib/useVoiceOrder";

type Tone = "idle" | "listening" | "busy";

const HINTS = [
  "Two veg burgers under 300",
  "What's a good combo for four?",
  "What desserts do you have?",
];

function getStatus(
  phase: Phase,
  agent: AgentState,
  hasReceipt: boolean,
): { label: string; tone: Tone } {
  if (phase === "connecting") return { label: "Connecting…", tone: "busy" };
  if (phase === "live") {
    if (agent === "listening") return { label: "Listening", tone: "listening" };
    if (agent === "thinking") return { label: "One moment", tone: "busy" };
    if (agent === "speaking") return { label: "Speaking", tone: "busy" };
    return { label: "Waiting for the assistant…", tone: "busy" };
  }
  if (phase === "ended") {
    return hasReceipt
      ? { label: "Order placed", tone: "idle" }
      : { label: "Call ended", tone: "idle" };
  }
  return { label: "Ready when you are", tone: "idle" };
}

export default function Page() {
  const { isLoaded, isSignedIn } = useAuth();
  const { phase, agentState, lines, receipt, muted, error, start, end, toggleMute } =
    useVoiceOrder();
  const status = getStatus(phase, agentState, Boolean(receipt));

  const isGuest = isLoaded && !isSignedIn;
  const showHints = phase !== "ended" && lines.length === 0;

  const startLabel =
    phase === "connecting"
      ? "Connecting…"
      : !isLoaded
        ? "Loading…"
        : phase === "ended" && receipt
          ? "New order"
          : isGuest
            ? "Start as guest"
            : "Start ordering";

  return (
    <main className="shell">
      <section className="board">
        <div className="board__top">
          <p className="board__name">Drive-thru voice order</p>
          {isSignedIn && <UserButton />}
        </div>

        <div className="board__main">
          <h1>Tell us what you&apos;d like.</h1>
          <p className="board__intro">
            Talk to the ordering assistant like you would at the window. Your
            receipt prints on the right when you confirm.
          </p>

          <div className="controls">
            {phase === "live" ? (
              <>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={toggleMute}
                  aria-pressed={muted}
                >
                  {muted ? "Unmute" : "Mute"}
                </button>
                <button type="button" className="btn btn--ghost" onClick={end}>
                  End call
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={start}
                  disabled={phase === "connecting" || !isLoaded}
                >
                  {startLabel}
                </button>
                {isGuest && phase !== "connecting" && (
                  <SignInButton mode="modal">
                    <button type="button" className="btn btn--ghost">
                      Sign in
                    </button>
                  </SignInButton>
                )}
              </>
            )}
          </div>

          {isGuest && phase !== "live" && (
            <p className="board__note">
              Guests get fewer orders a day. Sign in for more.
            </p>
          )}

          <p className={`status status--${status.tone}`} aria-live="polite">
            <span className="status__dot" aria-hidden="true" />
            {status.label}
          </p>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}

          {showHints && (
            <div className="hints">
              <p className="hints__label">Try saying</p>
              <ul>
                {HINTS.map((hint) => (
                  <li key={hint}>&ldquo;{hint}&rdquo;</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <ol className="captions" aria-label="Conversation">
          {lines.map((line) => (
            <li key={line.id} className="caption">
              <span className={`caption__who caption__who--${line.who}`}>
                {line.who === "you" ? "You" : "Assistant"}
              </span>
              {line.text}
            </li>
          ))}
        </ol>

        <p className="disclaimer">
          Unofficial portfolio demo, not affiliated with Burger King.
        </p>
      </section>

      <section className="lane" aria-live="polite">
        <Receipt receipt={receipt} />
      </section>
    </main>
  );
}
