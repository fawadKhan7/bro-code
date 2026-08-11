"use client";

import { useEffect, useState } from "react";
import type { Identity } from "../lib/useCoord";
import { defaultServerUrl } from "../lib/serverUrl";

const STORAGE_KEY = "brocode.identity";

/** Configured backend (NEXT_PUBLIC_COORD_URL) if set, else the LAN heuristic. */
function defaultUrl(): string {
  return defaultServerUrl();
}

export function JoinForm({ onJoin }: { onJoin: (identity: Identity) => void }) {
  const [url, setUrl] = useState("");
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [networkIdOverride, setNetworkIdOverride] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<Identity>;
        setUrl(parsed.url ?? defaultUrl());
        setUserId(parsed.userId ?? "");
        setDisplayName(parsed.displayName ?? "");
        setNetworkIdOverride(parsed.networkIdOverride ?? "");
        setReady(true);
        return;
      } catch {
        // Corrupt entry — fall through to defaults.
      }
    }
    setUrl(defaultUrl());
    setReady(true);
  }, []);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const identity: Identity = {
      url: url.trim().replace(/\/$/, ""),
      userId: userId.trim(),
      displayName: displayName.trim() || userId.trim(),
      ...(networkIdOverride.trim() ? { networkIdOverride: networkIdOverride.trim() } : {}),
    };
    if (!identity.url || !identity.userId) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    onJoin(identity);
  };

  if (!ready) return null;

  return (
    <form className="join" onSubmit={submit}>
      <h1>BroCode</h1>
      <p className="lede">
        Join the coordination server, find your teammate on the same network, and pair up.
        Your agent connects separately with the same id.
      </p>

      <label className="field">
        <span>Coordination server</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={defaultUrl()} spellCheck={false} />
        <span className="hint">The LAN address of the machine running the server.</span>
      </label>

      <label className="field">
        <span>Your id</span>
        <input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="coffee" spellCheck={false} />
        <span className="hint">Must match the id your agent connects with.</span>
      </label>

      <label className="field">
        <span>Display name</span>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Coffee" />
      </label>

      <label className="field">
        <span>Network group override (dev)</span>
        <input
          value={networkIdOverride}
          onChange={(e) => setNetworkIdOverride(e.target.value)}
          placeholder="leave empty on a real LAN"
          spellCheck={false}
        />
        <span className="hint">
          Only honoured when the server runs with COORD_ALLOW_NETWORK_OVERRIDE=1 — for testing both sides on one machine.
        </span>
      </label>

      <button className="btn primary" type="submit" style={{ width: "100%", marginTop: 6 }}>
        Join
      </button>
    </form>
  );
}
