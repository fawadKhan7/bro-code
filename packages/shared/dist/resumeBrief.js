export function buildResumeBrief(state, agentId) {
    const me = state.agents.find((a) => a.id === agentId);
    const peers = state.agents.filter((a) => a.id !== agentId);
    const lines = [];
    lines.push(`# Resume Brief — Agent ${agentId}${me ? ` (${me.role})` : ""} — v${state.resumeBriefVersion}`);
    lines.push(`Goal: ${state.goal}`);
    lines.push(`Phase: ${state.phase}   Mode: ${state.mode}`);
    lines.push("");
    const mine = state.board.filter((i) => (i.owner === agentId || i.claimedBy === agentId) && i.status !== "done" && i.status !== "out-of-scope");
    lines.push("Your board items:");
    if (mine.length === 0) {
        lines.push("  (none remaining)");
    }
    else {
        for (const i of mine) {
            lines.push(`  ${i.id} ${i.status.padEnd(7)} ${i.title}${i.paths.length ? `   ${i.paths.join(", ")}` : ""}`);
        }
    }
    lines.push("");
    lines.push("Contracts in force:");
    if (state.contracts.length === 0) {
        lines.push("  (none)");
    }
    else {
        // Latest revision per service slug only.
        const latest = new Map();
        for (const c of state.contracts)
            latest.set(c.service, c);
        for (const c of latest.values()) {
            lines.push(`  ${c.service} rev${c.revision} (sha256:${c.contentHash.slice(0, 8)}…)${c.diskPath ? ` → ${c.diskPath}` : ""}`);
        }
    }
    lines.push("");
    const peerDone = state.board.filter((i) => i.status === "done" && i.claimedBy !== agentId);
    if (peerDone.length > 0) {
        lines.push("Peer completions:");
        for (const i of peerDone) {
            lines.push(`  ${i.id} ${i.title}${i.refs.length ? `   refs: ${i.refs.join(", ")}` : ""}`);
        }
        lines.push("");
    }
    if (peers.length > 0) {
        lines.push(`Peers: ${peers.map((p) => `Agent ${p.id} (${p.role}, ${p.workspace})`).join("; ")}`);
    }
    if (state.lastFeedback) {
        lines.push("");
        lines.push(`Latest human feedback: ${state.lastFeedback}`);
    }
    return lines.join("\n");
}
//# sourceMappingURL=resumeBrief.js.map