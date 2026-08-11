"use client";

import { useEffect, useState } from "react";
import type { IncomingRequest } from "../lib/useCoord";

/** The incoming pairing prompt. Both users are soft-locked while it is open, so
 *  the countdown is the honest thing to show. */
export function ConnectPrompt({
  request,
  onRespond,
}: {
  request: IncomingRequest;
  onRespond: (decision: "approve" | "reject") => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, request.expiresAt - Date.now()));

  useEffect(() => {
    const tick = setInterval(() => setRemaining(Math.max(0, request.expiresAt - Date.now())), 250);
    return () => clearInterval(tick);
  }, [request.expiresAt]);

  return (
    <div className="scrim">
      <div className="prompt" role="dialog" aria-modal="true" aria-labelledby="connect-prompt-title">
        <h3 id="connect-prompt-title">{request.fromDisplayName} wants to pair</h3>
        <p>
          Approving opens a BroCode session. You both become <strong>reserved</strong>, and the queues, locks and
          approval inbox start running scoped to it.
        </p>
        <div className="actions">
          <button className="btn good" onClick={() => onRespond("approve")}>
            Approve
          </button>
          <button className="btn danger" onClick={() => onRespond("reject")}>
            Reject
          </button>
        </div>
        <p className="countdown">expires in {Math.ceil(remaining / 1000)}s</p>
      </div>
    </div>
  );
}
