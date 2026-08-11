"use client";

import { useEffect, useState } from "react";
import { ConnectPrompt } from "../components/ConnectPrompt";
import { JoinForm } from "../components/JoinForm";
import { RosterPanel } from "../components/RosterPanel";
import { SessionView } from "../components/SessionView";
import { useCoord, type Identity } from "../lib/useCoord";
import { configuredServerUrl } from "../lib/serverUrl";

/** `?user=coffee&name=Coffee` joins straight away. The backend is `?server=` if
 *  given, else the build-time NEXT_PUBLIC_COORD_URL (split deploy), else the
 *  origin that served the page (all-in-one / same-origin). */
function identityFromUrl(): Identity | null {
  const params = new URLSearchParams(window.location.search);
  const userId = params.get("user")?.trim();
  if (!userId) return null;
  const network = params.get("network")?.trim();
  return {
    url: params.get("server")?.trim() || configuredServerUrl() || window.location.origin,
    userId,
    displayName: params.get("name")?.trim() || userId,
    ...(network ? { networkIdOverride: network } : {}),
  };
}

export default function Page() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  // Deliberately not persisted: a URL-driven identity must not leak into the other tab.
  const [resolved, setResolved] = useState(false);
  const coord = useCoord(identity);

  useEffect(() => {
    setIdentity(identityFromUrl());
    setResolved(true);
  }, []);

  if (!resolved) return null;
  if (!identity) return <JoinForm onJoin={setIdentity} />;

  const partner = coord.session?.participants.find((participant) => participant !== identity.userId);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          BroCode <small>coordination</small>
        </div>
        <span className="spacer" />
        <div className="meta">
          <span>{identity.displayName}</span>
          <span className="sep">·</span>
          <span>{coord.me?.networkId ?? "…"}</span>
          <span className="sep">·</span>
          <span className={`pill ${coord.status === "online" ? (coord.me?.state ?? "offline") : "offline"}`}>
            {coord.status === "online" ? (coord.me?.state ?? "connecting") : coord.status}
          </span>
        </div>
        {coord.session && (
          <button className="btn small danger" onClick={coord.endSession}>
            End session
          </button>
        )}
      </header>

      {coord.error && (
        <div className="banner" onClick={coord.dismissError} role="alert" title="click to dismiss">
          {coord.error}
        </div>
      )}

      {coord.session && coord.snapshot ? (
        <>
          <div className="session-bar">
            <div className="pair">
              <span>{identity.displayName}</span>
              <span className="arrow">↔</span>
              <span>{partner ?? "—"}</span>
            </div>
            <span className="spacer" />
            <div className="meta">
              <span>session {coord.session.sessionId.slice(0, 8)}</span>
              <span className="sep">·</span>
              <span>started {new Date(coord.snapshot.startedAt).toLocaleTimeString([], { hour12: false })}</span>
            </div>
          </div>
          <SessionView
            snapshot={coord.snapshot}
            me={identity.userId}
            onResolveApproval={coord.resolveApproval}
          />
          <p className="readonly-note">
            Read-only view. Commands come from each human&apos;s own agent client; the only actions here are Connect and Approve.
          </p>
        </>
      ) : (
        <RosterPanel roster={coord.roster} meId={identity.userId} onConnect={coord.connectTo} />
      )}

      {coord.incoming && <ConnectPrompt request={coord.incoming} onRespond={coord.respond} />}
    </div>
  );
}
