"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ParticipantKind,
  Room,
  RoomEvent,
  Track,
  type Participant,
} from "livekit-client";

// Must match BKAgent.ORDER_TOPIC in agent.py.
const RECEIPT_TOPIC = "bk-order-receipt";
// Topic LiveKit Agents uses to publish live captions.
const TRANSCRIPTION_TOPIC = "lk.transcription";

export type Phase = "idle" | "connecting" | "live" | "ended";
export type AgentState =
  | "initializing"
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "unknown";

export type Line = { id: string; who: "you" | "assistant"; text: string };
export type ReceiptItem = { name: string; quantity: number; price: number };
export type ReceiptData = {
  orderId: string;
  items: ReceiptItem[];
  total: number;
  placedAt: string;
};

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

// The LLM builds the item list, so be forgiving about missing or odd fields.
function parseReceipt(raw: Record<string, any>): ReceiptData {
  const items: ReceiptItem[] = Array.isArray(raw.items)
    ? raw.items.map((item: Record<string, any>) => ({
        name: String(item?.name ?? "Item"),
        quantity: Math.max(1, Math.round(toNumber(item?.quantity ?? 1))),
        price: toNumber(item?.price),
      }))
    : [];
  return {
    orderId: String(raw.order_id ?? ""),
    items,
    total: toNumber(raw.total),
    placedAt: String(raw.placed_at ?? ""),
  };
}

// Thrown when /api/token refuses. userMessage is the server's plain-language
// reason (signed out, daily limit reached, ...) and is shown to the customer.
class TokenError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage?: string,
  ) {
    super(`token route returned ${status}`);
  }
}

function removeAgentAudio() {
  document
    .querySelectorAll("audio[data-bk-agent]")
    .forEach((el) => el.remove());
}

export function useVoiceOrder() {
  const roomRef = useRef<Room | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [agentState, setAgentState] = useState<AgentState>("unknown");
  const [lines, setLines] = useState<Line[]>([]);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (roomRef.current) return;

    setError(null);
    setReceipt(null);
    setLines([]);
    setMuted(false);
    setAgentState("unknown");
    setPhase("connecting");

    const room = new Room();
    roomRef.current = room;

    const upsertLine = (id: string, who: Line["who"], text: string) => {
      if (!text.trim()) return;
      setLines((prev) => {
        const i = prev.findIndex((l) => l.id === id);
        const next =
          i === -1
            ? [...prev, { id, who, text }]
            : prev.map((l, j) => (j === i ? { ...l, text } : l));
        return next.slice(-6);
      });
    };

    const syncAgentState = (participant: Participant) => {
      if (participant.kind !== ParticipantKind.AGENT) return;
      setAgentState(
        (participant.attributes["lk.agent.state"] as AgentState) ?? "unknown",
      );
    };

    // Play the assistant's voice.
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      const el = track.attach();
      el.dataset.bkAgent = "1";
      document.body.appendChild(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      track.detach().forEach((el) => el.remove());
    });

    room.on(RoomEvent.ParticipantConnected, syncAgentState);
    room.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) =>
      syncAgentState(participant),
    );

    room.on(RoomEvent.Disconnected, () => {
      removeAgentAudio();
      roomRef.current = null;
      setPhase("ended");
    });

    // Register handlers BEFORE connecting so no message is missed.
    room.registerTextStreamHandler(RECEIPT_TOPIC, async (reader) => {
      try {
        setReceipt(parseReceipt(JSON.parse(await reader.readAll())));
      } catch (e) {
        console.error("Could not read the receipt", e);
      }
    });

    room.registerTextStreamHandler(TRANSCRIPTION_TOPIC, async (reader) => {
      const attrs = reader.info.attributes ?? {};
      const id = attrs["lk.segment_id"] ?? reader.info.id;
      // Only captions of the customer's speech carry a transcribed track id.
      const who: Line["who"] = attrs["lk.transcribed_track_id"]
        ? "you"
        : "assistant";
      let text = "";
      for await (const chunk of reader) {
        text += chunk;
        upsertLine(id, who, text);
      }
    });

    let step: "token" | "connect" | "mic" = "token";
    try {
      const res = await fetch("/api/token", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new TokenError(
          res.status,
          typeof body?.message === "string" ? body.message : undefined,
        );
      }
      const { serverUrl, token } = await res.json();

      step = "connect";
      await room.connect(serverUrl, token);
      await room.startAudio().catch(() => {});

      step = "mic";
      await room.localParticipant.setMicrophoneEnabled(true);

      room.remoteParticipants.forEach(syncAgentState);
      setPhase("live");
    } catch (e) {
      console.error(e);
      room.removeAllListeners();
      await room.disconnect().catch(() => {});
      removeAgentAudio();
      roomRef.current = null;
      setPhase("idle");
      setError(
        e instanceof TokenError && e.userMessage
          ? e.userMessage
          : step === "token"
          ? "Couldn't start the call. Check that LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET are set for the token route."
          : step === "mic"
            ? "Microphone blocked. Allow microphone access in your browser, then try again."
            : "Couldn't connect to the ordering assistant. Try again.",
      );
    }
  }, []);

  const end = useCallback(() => {
    void roomRef.current?.disconnect();
  }, []);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextMuted = !muted;
    await room.localParticipant.setMicrophoneEnabled(!nextMuted);
    setMuted(nextMuted);
  }, [muted]);

  useEffect(() => {
    return () => {
      void roomRef.current?.disconnect();
    };
  }, []);

  return { phase, agentState, lines, receipt, muted, error, start, end, toggleMute };
}
