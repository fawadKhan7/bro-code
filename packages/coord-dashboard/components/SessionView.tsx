"use client";

import type {
  ActivityEntry,
  AgentRef,
  ApprovalPayload,
  ContractPayload,
  HeldLock,
  PendingApproval,
  QueuedCommand,
  SessionSnapshot,
} from "@duo/coord-client";

function clockOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour12: false });
}

function secondsUntil(iso: string): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}

/** Everything a paired session shows. Read-only except the approval buttons —
 *  observation is symmetric, so nothing here is filtered by who is looking.
 *
 *  Agents carry no role: each lane is one participant's agent, and the two accent
 *  colours are assigned by position in the session, not by any label. */
export function SessionView({
  snapshot,
  me,
  onResolveApproval,
}: {
  snapshot: SessionSnapshot;
  me: AgentRef;
  onResolveApproval: (requestId: string, requesterAgent: AgentRef, decision: ApprovalPayload["decision"]) => void;
}) {
  /** Stable per session, so a lane never changes colour mid-run. */
  const laneOf = (agent: AgentRef): "a" | "b" => (snapshot.participants[0] === agent ? "a" : "b");

  return (
    <div className="grid">
      {snapshot.participants.map((participant) => (
        <AgentLane
          key={participant}
          agent={participant}
          lane={laneOf(participant)}
          isMine={participant === me}
          commands={snapshot.queues[participant] ?? []}
          activity={snapshot.activity.filter((entry) => entry.agent === participant)}
        />
      ))}

      <div className="side">
        <ApprovalInbox approvals={snapshot.approvals} me={me} laneOf={laneOf} onResolve={onResolveApproval} />
        <LocksPanel locks={snapshot.locks} laneOf={laneOf} />
        <ContractsPanel contracts={snapshot.contracts} />
      </div>

      <div style={{ gridColumn: "1 / -1" }}>
        <ActivityStream activity={snapshot.activity} laneOf={laneOf} />
      </div>
    </div>
  );
}

function AgentLane({
  agent,
  lane,
  isMine,
  commands,
  activity,
}: {
  agent: AgentRef;
  lane: "a" | "b";
  isMine: boolean;
  commands: QueuedCommand[];
  activity: ActivityEntry[];
}) {
  const current = activity[activity.length - 1];
  const pending = commands.filter((command) => command.status !== "done" && command.status !== "failed");

  return (
    <section className="panel lane" data-lane={lane}>
      <header>
        <span className="pill" data-lane={lane}>
          {agent}
        </span>
        <h2>agent</h2>
        <span className="owner">{isMine ? "yours — you command it" : "your partner's"}</span>
      </header>

      <div className="now">
        {current ? (
          <>
            <div className="task">{current.payload.task || "—"}</div>
            <div className="action">{current.payload.currentAction}</div>
            {current.payload.filesTouched.length > 0 && (
              <div className="files">
                {current.payload.filesTouched.slice(0, 8).map((file) => (
                  <span className="chip" key={file}>
                    {file}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="action">idle — nothing reported yet</div>
        )}
      </div>

      <div className="body flush">
        {commands.length === 0 ? (
          <p className="empty">Queue is empty.</p>
        ) : (
          commands.map((command, index) => (
            <div className="cmd" data-status={command.status} key={command.id}>
              <span className="idx">{command.status === "done" || command.status === "failed" ? "·" : index + 1}</span>
              <div className="detail">
                <div className="intent">{command.intent}</div>
                <div className="sub">
                  from {command.issuedBy}
                  {command.originRequestId ? " · via approval" : ""}
                  {command.priority === "urgent" ? " · urgent" : ""}
                  {command.scope.length > 0 ? ` · ${command.scope.join(", ")}` : ""}
                  {command.blockedOn?.length ? ` · blocked on ${command.blockedOn.join(", ")}` : ""}
                </div>
              </div>
              <span className="status" data-s={command.status}>
                {command.status === "waiting-on-locks" ? "waiting" : command.status}
              </span>
            </div>
          ))
        )}
      </div>

      {pending.length > 1 && (
        <div className="row">
          <span className="sub">{pending.length - 1} command(s) waiting behind the one in flight</span>
        </div>
      )}
    </section>
  );
}

function ApprovalInbox({
  approvals,
  me,
  laneOf,
  onResolve,
}: {
  approvals: PendingApproval[];
  me: AgentRef;
  laneOf: (agent: AgentRef) => "a" | "b";
  onResolve: (requestId: string, requesterAgent: AgentRef, decision: ApprovalPayload["decision"]) => void;
}) {
  return (
    <section className="panel">
      <header>
        <h2>Cross-agent approvals</h2>
        <span className="count">{approvals.length}</span>
      </header>
      <div className="body flush">
        {approvals.length === 0 ? (
          <p className="empty">No proposals waiting.</p>
        ) : (
          approvals.map((approval) => {
            // An agent is addressed by its owner, so `to` is exactly who may decide.
            const mine = approval.to === me;
            return (
              <div className="row approval" key={approval.requestId}>
                <div className="line">
                  <span className="sub">
                    <span className="pill" data-lane={laneOf(approval.from)}>
                      {approval.from}
                    </span>{" "}
                    →{" "}
                    <span className="pill" data-lane={laneOf(approval.to)}>
                      {approval.to}
                    </span>
                  </span>
                  {approval.blocking && <span className="pill plain warn">blocking</span>}
                </div>
                <p className="summary">{approval.summary}</p>
                {approval.proposedContract && (
                  <div className="sub" style={{ marginBottom: 8 }}>
                    proposes {approval.proposedContract.method} {approval.proposedContract.endpoint} v
                    {approval.proposedContract.version}
                    {approval.proposedContract.breaking ? " (breaking)" : ""}
                  </div>
                )}
                {mine ? (
                  <div className="actions">
                    <button className="btn small good" onClick={() => onResolve(approval.requestId, approval.from, "accept")}>
                      Accept
                    </button>
                    <button className="btn small danger" onClick={() => onResolve(approval.requestId, approval.from, "reject")}>
                      Reject
                    </button>
                    <button className="btn small" onClick={() => onResolve(approval.requestId, approval.from, "renegotiate")}>
                      Renegotiate
                    </button>
                  </div>
                ) : (
                  <span className="gated">{approval.to} gates this — it is their agent.</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function LocksPanel({ locks, laneOf }: { locks: HeldLock[]; laneOf: (agent: AgentRef) => "a" | "b" }) {
  return (
    <section className="panel">
      <header>
        <h2>Held locks</h2>
        <span className="count">{locks.length}</span>
      </header>
      <div className="body flush">
        {locks.length === 0 ? (
          <p className="empty">Nothing leased.</p>
        ) : (
          locks.map((lock) => (
            <div className="row" key={`${lock.holder}-${lock.resource}`}>
              <div className="line">
                <code>{lock.resource}</code>
                <span className="pill" data-lane={laneOf(lock.holder)}>
                  {lock.holder}
                </span>
              </div>
              <div className="sub">lease expires in {secondsUntil(lock.expiresAt)}s</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ContractsPanel({ contracts }: { contracts: ContractPayload[] }) {
  return (
    <section className="panel">
      <header>
        <h2>API contract</h2>
        <span className="count">{contracts.length}</span>
      </header>
      <div className="body flush">
        {contracts.length === 0 ? (
          <p className="empty">No contract published yet.</p>
        ) : (
          contracts.map((contract) => (
            <div className="row" key={`${contract.method} ${contract.endpoint}`}>
              <div className="line">
                <code>
                  {contract.method} {contract.endpoint}
                </code>
                {contract.breaking ? <span className="pill breaking">breaking</span> : null}
              </div>
              <div className="sub">v{contract.version}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ActivityStream({ activity, laneOf }: { activity: ActivityEntry[]; laneOf: (agent: AgentRef) => "a" | "b" }) {
  const newestFirst = [...activity].reverse();
  return (
    <section className="panel">
      <header>
        <h2>Activity</h2>
        <span className="count">{activity.length}</span>
      </header>
      <div className="body flush stream">
        {newestFirst.length === 0 ? (
          <p className="empty">Nothing on the bus yet.</p>
        ) : (
          newestFirst.map((entry) => (
            <div className="event" data-lane={laneOf(entry.agent)} data-status={entry.payload.status} key={entry.id}>
              <span className="at">{clockOf(entry.at)}</span>
              <span className="agent">{entry.agent}</span>
              <span className="what">
                <strong>{entry.payload.currentAction}</strong>
                {entry.payload.task ? <span className="task"> — {entry.payload.task}</span> : null}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
