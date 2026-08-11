"use client";

import type { RosterEntry } from "@duo/coord-client";

/** The network roster: everyone the coordinator sees on your network group.
 *  Connect is enabled only for `available` users — a `pending` or `reserved`
 *  person is spoken for. */
export function RosterPanel({
  roster,
  meId,
  onConnect,
}: {
  roster: RosterEntry[];
  meId: string;
  onConnect: (userId: string) => void;
}) {
  const me = roster.find((entry) => entry.userId === meId);
  const canInitiate = me?.state === "available";

  return (
    <div className="roster-layout">
      <section className="panel">
        <header>
          <h2>Network roster</h2>
          <span className="count">{roster.length}</span>
        </header>
        <div className="body flush">
          {roster.length === 0 ? (
            <p className="empty">Nobody here yet. Waiting for the roster…</p>
          ) : (
            roster.map((entry) => {
              const isMe = entry.userId === meId;
              return (
                <div className={`roster-row${isMe ? " self" : ""}`} key={entry.userId}>
                  <div className="who">
                    <strong>
                      {entry.displayName}
                      {isMe ? " (you)" : ""}
                    </strong>
                    <span className="sub">
                      {entry.userId}
                      {entry.partnerId ? ` · paired with ${entry.partnerId}` : ""}
                      {entry.agentOnline ? "" : " · agent offline"}
                    </span>
                  </div>
                  <span className={`pill ${entry.state}`}>{entry.state}</span>
                  {!isMe && (
                    <button
                      className="btn small primary"
                      disabled={!canInitiate || entry.state !== "available"}
                      onClick={() => onConnect(entry.userId)}
                      title={
                        entry.state !== "available"
                          ? `${entry.displayName} is ${entry.state}`
                          : !canInitiate
                            ? `you are ${me?.state ?? "offline"}`
                            : `Send ${entry.displayName} a connect request`
                      }
                    >
                      Connect
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
      <p className="note">
        Discovery is network-scoped — you only see people reaching the coordinator from your own network.
      </p>
    </div>
  );
}
