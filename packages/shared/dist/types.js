/** Core domain types for the Duo system. Agents are a list, never an A/B pair. */
export function emptySession() {
    return {
        active: false,
        phase: "init",
        goal: "",
        mode: "auto-run",
        autoApproveTrivial: true,
        agents: [],
        registrations: {},
        planProposals: {},
        proposedBoard: [],
        board: [],
        boardVersion: 0,
        contracts: [],
        contractVersion: 0,
        contractRevisionBySlug: {},
        checkpoints: {},
        logs: [],
        lastFeedback: null,
        resumeBriefVersion: 0,
        startedAt: "",
    };
}
//# sourceMappingURL=types.js.map