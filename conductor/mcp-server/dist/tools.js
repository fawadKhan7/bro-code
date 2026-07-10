"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.callConductorTool = callConductorTool;
const shared_1 = require("@conductor/shared");
function parseAgentId(raw) {
    const id = String(raw ?? "").toLowerCase();
    if (id === "agent-a" || id === "a")
        return "agent-a";
    if (id === "agent-b" || id === "b")
        return "agent-b";
    throw new Error("agent_id must be agent-a or agent-b");
}
function callConductorTool(name, args) {
    const session = (0, shared_1.loadSession)();
    if (!session.active) {
        throw new Error("No active Conductor session. Run: conductor start \"<goal>\"");
    }
    switch (name) {
        case "get_contract": {
            const agentId = parseAgentId(args.agent_id);
            const sinceVersion = Number(args.sinceVersion ?? 0);
            const peer = (0, shared_1.peerId)(agentId);
            const filtered = session.updates.filter((u) => u.version > sinceVersion && u.from === peer);
            const text = filtered.length
                ? filtered
                    .map((u) => {
                    const refs = u.refs?.length ? `\n     refs: ${u.refs.join(", ")}` : "";
                    return `[v${u.version}] ${u.from} → ${u.summary}${refs}`;
                })
                    .join("\n")
                : "(no new updates from peer)";
            return {
                sinceVersion,
                latestVersion: session.contractVersion,
                peer,
                lines: text,
            };
        }
        case "post_update": {
            const from = parseAgentId(args.from ?? args.agent_id);
            const type = String(args.type ?? "update");
            const summary = String(args.summary ?? "");
            if (!summary)
                throw new Error("summary is required");
            let diff;
            if (args.diff && typeof args.diff === "object") {
                const d = args.diff;
                diff = {
                    added: Array.isArray(d.added) ? d.added.map(String) : undefined,
                    removed: Array.isArray(d.removed) ? d.removed.map(String) : undefined,
                    changed: Array.isArray(d.changed) ? d.changed.map(String) : undefined,
                };
            }
            const refs = Array.isArray(args.refs) ? args.refs.map(String) : undefined;
            let version = 0;
            (0, shared_1.updateSession)((s) => {
                version = (0, shared_1.appendUpdate)(s, { from, type, summary, diff, refs }).version;
            });
            return { ok: true, version };
        }
        case "post_checkpoint": {
            const agentId = parseAgentId(args.agent_id);
            const summary = String(args.summary ?? "");
            const nextStep = String(args.next_step ?? "");
            (0, shared_1.updateSession)((s) => (0, shared_1.setCheckpoint)(s, agentId, summary, nextStep));
            return {
                ok: true,
                message: "Checkpoint recorded. Waiting for user: conductor feedback",
                checkpointPhase: "waiting_user",
            };
        }
        case "get_resume_brief": {
            parseAgentId(args.agent_id);
            if (!session.resumeBrief) {
                return {
                    available: false,
                    message: "No resume brief yet. User must run conductor feedback first.",
                };
            }
            return {
                available: true,
                version: session.resumeBriefVersion,
                brief: session.resumeBrief,
            };
        }
        case "get_status": {
            const agentId = args.agent_id != null ? parseAgentId(args.agent_id) : null;
            const peer = agentId ? (0, shared_1.peerId)(agentId) : null;
            const peerUpdates = peer
                ? session.updates.filter((u) => u.from === peer)
                : session.updates;
            return {
                active: session.active,
                goal: session.goal,
                checkpointPhase: session.checkpointPhase,
                contractVersion: session.contractVersion,
                latestPeerUpdate: peerUpdates.length
                    ? peerUpdates[peerUpdates.length - 1]
                    : null,
                checkpointA: session.checkpointA,
                checkpointB: session.checkpointB,
                resumeBriefVersion: session.resumeBriefVersion,
            };
        }
        default:
            throw new Error(`Unknown tool: ${name}`);
    }
}
// Fix post_update return - appendUpdate returns entry wrong. Let me fix tools.ts
//# sourceMappingURL=tools.js.map