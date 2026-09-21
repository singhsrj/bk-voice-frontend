"use client";

import { Receipt } from "@/components/Receipt";
import {
  useVoiceOrder,
  type AgentState,
  type Phase,
} from "@/lib/useVoiceOrder";

type Tone = "idle" | "listening" | "busy";

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
  const { phase, agentState, lines, receipt, muted, error, start, end, toggleMute } =
    useVoiceOrder();
  const status = getStatus(phase, agentState, Boolean(receipt));

  return (
    <main className="shell">
      <section className="board">
        <p className="board__name">Drive-thru voice order</p>

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
              <button
                type="button"
                className="btn btn--primary"
                onClick={start}
                disabled={phase === "connecting"}
              >
                {phase === "connecting"
                  ? "Connecting…"
                  : phase === "ended" && receipt
                    ? "New order"
                    : "Start ordering"}
              </button>
            )}
          </div>

          <p className={`status status--${status.tone}`} aria-live="polite">
            <span className="status__dot" aria-hidden="true" />
            {status.label}
          </p>

          {error && (
            <p className="error" role="alert">
              {error}
            </p>
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
      </section>

      <section className="lane" aria-live="polite">
        <Receipt receipt={receipt} />
      </section>
    </main>
  );
}
