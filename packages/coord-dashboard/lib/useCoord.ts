"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CONNECT_REQUEST_TIMEOUT_MS,
  CoordClient,
  type AgentRef,
  type ApprovalPayload,
  type ConnectRequestPayload,
  type HumanId,
  type RosterEntry,
  type SessionEstablishedPayload,
  type SessionSnapshot,
} from "@duo/coord-client";

export interface Identity {
  url: string;
  userId: string;
  displayName: string;
  /** Dev only, and only honoured when the server allows it. */
  networkIdOverride?: string;
}

export type ConnectionStatus = "idle" | "connecting" | "online" | "error";

export interface IncomingRequest extends ConnectRequestPayload {
  expiresAt: number;
}

export interface Coord {
  status: ConnectionStatus;
  error: string | null;
  roster: RosterEntry[];
  session: SessionEstablishedPayload | null;
  snapshot: SessionSnapshot | null;
  incoming: IncomingRequest | null;
  me: RosterEntry | undefined;
  /** The only two write actions this dashboard has. Everything else is observe-only. */
  connectTo: (userId: HumanId) => void;
  respond: (decision: "approve" | "reject") => void;
  resolveApproval: (requestId: string, requesterAgent: AgentRef, decision: ApprovalPayload["decision"]) => void;
  endSession: () => void;
  dismissError: () => void;
}

export function useCoord(identity: Identity | null): Coord {
  const client = useRef<CoordClient | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [session, setSession] = useState<SessionEstablishedPayload | null>(null);
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [incoming, setIncoming] = useState<IncomingRequest | null>(null);

  useEffect(() => {
    if (!identity) return;

    const coord = new CoordClient({
      url: identity.url,
      auth: {
        userId: identity.userId,
        displayName: identity.displayName,
        // A dashboard is the human end. Agents connect separately with role 'agent'.
        role: "human",
        ...(identity.networkIdOverride ? { networkIdOverride: identity.networkIdOverride } : {}),
      },
    });
    client.current = coord;

    const unsubscribe = [
      coord.on("roster", setRoster),
      coord.on("snapshot", setSnapshot),
      coord.on("connect-request", ({ payload }) =>
        setIncoming({ ...payload, expiresAt: Date.now() + CONNECT_REQUEST_TIMEOUT_MS }),
      ),
      coord.on("session-established", ({ payload }) => {
        setSession(payload);
        setIncoming(null);
      }),
      coord.on("session-ended", () => {
        setSession(null);
        setSnapshot(null);
        setIncoming(null);
      }),
      coord.on("error", ({ message }) => setError(message)),
      coord.on("disconnected", () => setStatus("connecting")),
      coord.on("connected", () => setStatus("online")),
    ];

    setStatus("connecting");
    coord.connect().catch((err: Error) => {
      setStatus("error");
      setError(err.message);
    });

    return () => {
      for (const off of unsubscribe) off();
      coord.disconnect();
      client.current = null;
      setStatus("idle");
      setRoster([]);
      setSession(null);
      setSnapshot(null);
      setIncoming(null);
    };
  }, [identity]);

  // A request that ran out the clock is already dead on the server; stop showing it.
  useEffect(() => {
    if (!incoming) return;
    const remaining = incoming.expiresAt - Date.now();
    const timer = setTimeout(() => setIncoming(null), Math.max(remaining, 0));
    return () => clearTimeout(timer);
  }, [incoming]);

  const connectTo = useCallback((userId: HumanId) => {
    client.current?.requestConnect(userId).catch((err: Error) => setError(err.message));
  }, []);

  const respond = useCallback(
    (decision: "approve" | "reject") => {
      if (!incoming) return;
      client.current?.respondConnect(incoming.requestId, decision, incoming.fromUser).catch((err: Error) => setError(err.message));
      setIncoming(null);
    },
    [incoming],
  );

  const resolveApproval = useCallback(
    (requestId: string, requesterAgent: AgentRef, decision: ApprovalPayload["decision"]) => {
      client.current?.resolveRequest(requesterAgent, { requestId, decision }).catch((err: Error) => setError(err.message));
    },
    [],
  );

  const endSession = useCallback(() => {
    client.current?.endSession().catch((err: Error) => setError(err.message));
  }, []);

  return {
    status,
    error,
    roster,
    session,
    snapshot,
    incoming,
    me: roster.find((entry) => entry.userId === identity?.userId),
    connectTo,
    respond,
    resolveApproval,
    endSession,
    dismissError: () => setError(null),
  };
}
