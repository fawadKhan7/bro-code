/** SessionStore — the single writer over all session state.
 *  Rules enforced here: phase gates, claim validation, the completion rule,
 *  idempotent re-calls, write-through persistence, versioned reads.
 *  See docs/04-strategies-and-design-principles/state-management.md.
 */
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";
import { emptySession, hashContent, resolveServiceSlug, writeContractRevisionToDisk, buildResumeBrief, } from "@duo/shared";
const MAX_PLAN_ITEMS = 15;
const MAX_LOGS_IN_MEMORY = 2000;
function nowIso() {
    return new Date().toISOString();
}
function normTitle(t) {
    return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export class SessionStore {
    persistFile;
    events = new EventEmitter();
    state = emptySession();
    planWaiters = [];
    checkpointWaiters = new Map();
    constructor(persistFile) {
        this.persistFile = persistFile;
    }
    // ── Persistence ─────────────────────────────────────────────────────────────
    /** Write-through: called after every mutation, before the mutating call returns. */
    persist() {
        fs.mkdirSync(path.dirname(this.persistFile), { recursive: true });
        fs.writeFileSync(this.persistFile, JSON.stringify(this.state, null, 2), "utf8");
    }
    /** Restore a persisted session (hub restart). Returns true if one was loaded. */
    loadFromDisk() {
        try {
            const raw = fs.readFileSync(this.persistFile, "utf8");
            const parsed = JSON.parse(raw);
            if (!parsed.active)
                return false;
            this.state = { ...emptySession(), ...parsed };
            return true;
        }
        catch {
            return false;
        }
    }
    getState() {
        return this.state;
    }
    emit(event) {
        this.events.emit("hub-event", event);
    }
    rejection(error) {
        return { ok: false, phase: this.state.phase, error };
    }
    // ── Session lifecycle ───────────────────────────────────────────────────────
    createSession(input) {
        if (this.state.active) {
            return this.rejection("A session is already active. Stop it first (duo stop).");
        }
        if (input.agents.length < 2) {
            return this.rejection("A session needs at least 2 agents.");
        }
        const ids = new Set(input.agents.map((a) => a.id));
        if (ids.size !== input.agents.length) {
            return this.rejection("Agent ids must be unique.");
        }
        this.state = {
            ...emptySession(),
            active: true,
            goal: input.goal,
            mode: input.mode ?? "auto-run",
            autoApproveTrivial: input.autoApproveTrivial ?? true,
            agents: input.agents,
            startedAt: nowIso(),
            phase: input.plan === false ? "executing" : "planning",
        };
        if (input.plan === false) {
            const items = input.presetBoard ?? [];
            this.state.board = items.map((it, idx) => this.toBoardItem(it, `t${idx + 1}`, null));
            // Preset board items must be owned — the CLI derives one per agent.
            for (const item of this.state.board) {
                if (!item.owner && item.ownerHint && ids.has(item.ownerHint))
                    item.owner = item.ownerHint;
            }
            this.state.boardVersion = 1;
            for (const item of this.state.board)
                item.version = 1;
        }
        this.persist();
        this.emit({ type: "phase", data: { phase: this.state.phase, goal: this.state.goal } });
        return { ok: true };
    }
    /** Archive to history and reset. Returns the archive path (or null if nothing active). */
    stopSession(historyDirPath) {
        if (!this.state.active)
            return null;
        let archivePath = null;
        try {
            fs.mkdirSync(historyDirPath, { recursive: true });
            const stamp = nowIso().replace(/[:.]/g, "-");
            archivePath = path.join(historyDirPath, `${stamp}.json`);
            fs.writeFileSync(archivePath, JSON.stringify(this.state, null, 2), "utf8");
        }
        catch {
            archivePath = null;
        }
        this.resolvePlanWaiters({ approved: false, feedback: "Session stopped by user." });
        this.state = emptySession();
        this.persist();
        this.emit({ type: "phase", data: { phase: "stopped" } });
        return archivePath;
    }
    // ── Registration ────────────────────────────────────────────────────────────
    registerAgent(agentId, workspacePath) {
        if (!this.state.active)
            return this.rejection("No active session.");
        const agent = this.state.agents.find((a) => a.id === agentId);
        if (!agent) {
            return this.rejection(`Unknown agent_id "${agentId}". Configured agents: ${this.state.agents.map((a) => a.id).join(", ")}`);
        }
        // Idempotent: re-register just refreshes the timestamp.
        this.state.registrations[agentId] = { workspacePath, connectedAt: nowIso() };
        this.persist();
        this.emit({ type: "registration", data: this.registrationStatus() });
        return { ok: true, agentId, role: agent.role };
    }
    registrationStatus() {
        const out = {};
        for (const a of this.state.agents)
            out[a.id] = this.state.registrations[a.id] ?? null;
        return out;
    }
    allRegistered() {
        return this.state.agents.every((a) => !!this.state.registrations[a.id]);
    }
    /** Adapter reports an agent process exited: reopen its claims. */
    releaseAgent(agentId) {
        const reopened = [];
        for (const item of this.state.board) {
            if (item.claimedBy === agentId && item.status === "claimed") {
                item.status = "open";
                item.claimedBy = null;
                item.version = ++this.state.boardVersion;
                reopened.push(item.id);
            }
        }
        delete this.state.registrations[agentId];
        this.persist();
        this.emit({ type: "board", data: { reopened, boardVersion: this.state.boardVersion } });
        this.emit({ type: "registration", data: this.registrationStatus() });
        return { ok: true, reopened };
    }
    // ── Planning ────────────────────────────────────────────────────────────────
    toBoardItem(input, id, proposedBy) {
        const validOwner = input.ownerHint && this.state.agents.some((a) => a.id === input.ownerHint) ? input.ownerHint : null;
        return {
            id,
            title: String(input.title).slice(0, 200),
            owner: validOwner,
            ownerHint: validOwner,
            claimedBy: null,
            paths: (input.paths ?? []).map(String),
            status: "open",
            refs: [],
            version: 0,
            proposedBy,
        };
    }
    postPlan(agentId, items) {
        if (!this.state.active)
            return this.rejection("No active session.");
        if (this.state.phase !== "planning") {
            return this.rejection(this.state.phase === "executing"
                ? "Planning was skipped or already approved for this session. Call get_board and proceed with your assigned tasks."
                : `Cannot post a plan in phase "${this.state.phase}".`);
        }
        if (!this.state.agents.some((a) => a.id === agentId)) {
            return this.rejection(`Unknown agent_id "${agentId}".`);
        }
        if (!Array.isArray(items) || items.length === 0) {
            return this.rejection("Plan must contain at least one item.");
        }
        if (items.length > MAX_PLAN_ITEMS) {
            return this.rejection(`Plan exceeds ${MAX_PLAN_ITEMS} items (got ${items.length}). Merge related items — a plan is task titles and paths, not a work log.`);
        }
        // Idempotent replace of this agent's own proposal.
        this.state.planProposals[agentId] = items.map((i) => ({
            title: String(i.title).slice(0, 200),
            ownerHint: i.ownerHint ?? null,
            paths: (i.paths ?? []).map(String),
        }));
        const allPosted = this.state.agents.every((a) => !!this.state.planProposals[a.id]);
        if (allPosted)
            this.mergeProposals();
        this.persist();
        this.emit({
            type: "plan",
            data: { postedBy: agentId, allPosted, proposedBoard: allPosted ? this.state.proposedBoard : undefined },
        });
        // Trivial-plan fast path: ≤2 items, all owned → auto-approve.
        if (allPosted &&
            this.state.autoApproveTrivial &&
            this.state.proposedBoard.length <= 2 &&
            this.state.proposedBoard.every((i) => i.owner)) {
            this.approvePlan({});
            return { ok: true, merged: allPosted, autoApproved: true };
        }
        return { ok: true, merged: allPosted, itemCount: items.length };
    }
    /** Merge all proposals: concat in agent order, de-dup by normalized title or identical path sets. */
    mergeProposals() {
        const merged = [];
        const seenTitles = new Map();
        let counter = 0;
        for (const agent of this.state.agents) {
            for (const input of this.state.planProposals[agent.id] ?? []) {
                const key = normTitle(input.title);
                const existing = seenTitles.get(key);
                if (existing) {
                    // Duplicate: keep first; adopt an owner hint if the first had none.
                    if (!existing.owner && input.ownerHint && this.state.agents.some((a) => a.id === input.ownerHint)) {
                        existing.owner = input.ownerHint;
                        existing.ownerHint = input.ownerHint;
                    }
                    continue;
                }
                const item = this.toBoardItem(input, `t${++counter}`, agent.id);
                seenTitles.set(key, item);
                merged.push(item);
            }
        }
        this.state.proposedBoard = merged;
    }
    planStatus() {
        return {
            phase: this.state.phase,
            posted: this.state.agents.map((a) => ({ agentId: a.id, posted: !!this.state.planProposals[a.id] })),
            proposedBoard: this.state.proposedBoard,
            unassigned: this.state.proposedBoard.filter((i) => !i.owner).map((i) => i.id),
        };
    }
    /** Long-poll: resolves on approve/feedback, or {pending} after timeoutMs. */
    awaitPlanApproval(timeoutMs) {
        if (this.state.phase !== "planning") {
            // Already decided (or skipped): answer immediately and cheaply.
            return Promise.resolve(this.state.phase === "executing" || this.state.phase === "done"
                ? { approved: true }
                : { pending: true, retry: true });
        }
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.planWaiters = this.planWaiters.filter((w) => w !== waiter);
                resolve({ pending: true, retry: true });
            }, timeoutMs);
            const waiter = (decision) => {
                clearTimeout(timer);
                resolve(decision);
            };
            this.planWaiters.push(waiter);
        });
    }
    resolvePlanWaiters(decision) {
        const waiters = this.planWaiters;
        this.planWaiters = [];
        for (const w of waiters)
            w(decision);
    }
    approvePlan(edits) {
        if (this.state.phase !== "planning") {
            return this.rejection(`Cannot approve a plan in phase "${this.state.phase}".`);
        }
        if (this.state.proposedBoard.length === 0 && !(edits.add && edits.add.length > 0)) {
            return this.rejection("No proposed plan to approve yet.");
        }
        let items = [...this.state.proposedBoard];
        if (edits.remove)
            items = items.filter((i) => !edits.remove.includes(i.id));
        if (edits.add) {
            let counter = items.length;
            // Avoid id collisions with removed items by scanning existing ids.
            const used = new Set(items.map((i) => i.id));
            for (const input of edits.add) {
                let id = `t${++counter}`;
                while (used.has(id))
                    id = `t${++counter}`;
                used.add(id);
                items.push(this.toBoardItem(input, id, null));
            }
        }
        if (edits.assign) {
            for (const [taskId, agentId] of Object.entries(edits.assign)) {
                const item = items.find((i) => i.id === taskId);
                if (!item)
                    return this.rejection(`assign: no such item "${taskId}".`);
                if (!this.state.agents.some((a) => a.id === agentId)) {
                    return this.rejection(`assign: no such agent "${agentId}".`);
                }
                item.owner = agentId;
            }
        }
        if (edits.outOfScope) {
            for (const taskId of edits.outOfScope) {
                const item = items.find((i) => i.id === taskId);
                if (!item)
                    return this.rejection(`outOfScope: no such item "${taskId}".`);
                item.status = "out-of-scope";
            }
        }
        // Unassigned items block approval — the human must decide.
        const unassigned = items.filter((i) => i.status !== "out-of-scope" && !i.owner);
        if (unassigned.length > 0) {
            return this.rejection(`Cannot approve: unassigned items remain (${unassigned.map((i) => i.id).join(", ")}). ` +
                `Assign them (--assign tN=agentId) or mark them out of scope.`);
        }
        this.state.boardVersion += 1;
        for (const item of items)
            item.version = this.state.boardVersion;
        this.state.board = items;
        this.state.proposedBoard = [];
        this.state.phase = "executing";
        this.persist();
        this.emit({ type: "phase", data: { phase: "executing" } });
        this.emit({ type: "board", data: { boardVersion: this.state.boardVersion } });
        this.resolvePlanWaiters({ approved: true, edits });
        return { ok: true, board: this.state.board };
    }
    planFeedback(message) {
        if (this.state.phase !== "planning") {
            return this.rejection(`Cannot send plan feedback in phase "${this.state.phase}".`);
        }
        this.state.lastFeedback = message;
        // Clear proposals: agents revise and re-post.
        this.state.planProposals = {};
        this.state.proposedBoard = [];
        this.persist();
        this.emit({ type: "plan", data: { feedback: message } });
        this.resolvePlanWaiters({ approved: false, feedback: message });
        return { ok: true };
    }
    // ── Board / execution ───────────────────────────────────────────────────────
    getBoard(sinceVersion) {
        const items = sinceVersion && sinceVersion > 0
            ? this.state.board.filter((i) => i.version > sinceVersion)
            : this.state.board;
        return { phase: this.state.phase, boardVersion: this.state.boardVersion, items };
    }
    claimTask(agentId, taskId) {
        if (this.state.phase !== "executing") {
            return this.rejection(this.state.phase === "planning"
                ? "Session is still in the planning phase. Post your plan and wait for approval before claiming tasks."
                : `Cannot claim tasks in phase "${this.state.phase}".`);
        }
        const item = this.state.board.find((i) => i.id === taskId);
        if (!item)
            return this.rejection(`No such task "${taskId}".`);
        if (item.status === "claimed") {
            // Idempotent re-claim by the same claimant.
            if (item.claimedBy === agentId)
                return { ok: true, task: item };
            return this.rejection(`Task ${taskId} is already claimed by Agent ${item.claimedBy}.`);
        }
        if (item.status !== "open")
            return this.rejection(`Task ${taskId} is ${item.status}.`);
        if (item.owner && item.owner !== agentId) {
            return this.rejection(`Task ${taskId} is owned by Agent ${item.owner}. Claim only your own items; coordinate via contracts instead.`);
        }
        item.status = "claimed";
        item.claimedBy = agentId;
        item.version = ++this.state.boardVersion;
        this.persist();
        this.emit({ type: "board", data: { claimed: taskId, by: agentId, boardVersion: this.state.boardVersion } });
        return { ok: true, task: item };
    }
    completeTask(agentId, taskId, refs) {
        if (this.state.phase !== "executing") {
            return this.rejection(`Cannot complete tasks in phase "${this.state.phase}".`);
        }
        const item = this.state.board.find((i) => i.id === taskId);
        if (!item)
            return this.rejection(`No such task "${taskId}".`);
        if (item.status === "done")
            return { ok: true, task: item }; // idempotent
        if (item.status !== "claimed" || item.claimedBy !== agentId) {
            return this.rejection(`Task ${taskId} is not claimed by Agent ${agentId} (status: ${item.status}).`);
        }
        item.status = "done";
        item.refs = (refs ?? []).map(String);
        item.version = ++this.state.boardVersion;
        // The completion rule: session is done only when every item is done/out-of-scope.
        const remaining = this.state.board.filter((i) => i.status === "open" || i.status === "claimed");
        if (remaining.length === 0) {
            this.state.phase = "done";
            this.emit({ type: "phase", data: { phase: "done" } });
        }
        this.persist();
        this.emit({
            type: "board",
            data: { completed: taskId, by: agentId, boardVersion: this.state.boardVersion, remaining: remaining.length },
        });
        return { ok: true, task: item, sessionDone: this.state.phase === "done", remaining: remaining.length };
    }
    /** Human-only: mark items out of scope during execution (agents cannot shrink the goal). */
    markOutOfScope(taskIds) {
        if (this.state.phase !== "executing") {
            return this.rejection(`Cannot edit the board in phase "${this.state.phase}".`);
        }
        for (const id of taskIds) {
            const item = this.state.board.find((i) => i.id === id);
            if (!item)
                return this.rejection(`No such task "${id}".`);
            if (item.status === "done")
                return this.rejection(`Task ${id} is already done.`);
            item.status = "out-of-scope";
            item.claimedBy = null;
            item.version = ++this.state.boardVersion;
        }
        const remaining = this.state.board.filter((i) => i.status === "open" || i.status === "claimed");
        if (remaining.length === 0 && this.state.board.length > 0) {
            this.state.phase = "done";
            this.emit({ type: "phase", data: { phase: "done" } });
        }
        this.persist();
        this.emit({ type: "board", data: { boardVersion: this.state.boardVersion } });
        return { ok: true, remaining: remaining.length };
    }
    // ── Contracts ───────────────────────────────────────────────────────────────
    postContract(agentId, content, title, service) {
        if (!this.state.active)
            return this.rejection("No active session.");
        const agent = this.state.agents.find((a) => a.id === agentId);
        if (!agent)
            return this.rejection(`Unknown agent_id "${agentId}".`);
        if (!content.trim())
            return this.rejection("Contract content is empty.");
        const slug = resolveServiceSlug(content, service);
        const contentHash = hashContent(content);
        const revision = (this.state.contractRevisionBySlug[slug] ?? 0) + 1;
        const timestamp = nowIso();
        const workspacePath = this.state.registrations[agentId]?.workspacePath ?? agent.workspace;
        let diskPath;
        try {
            diskPath = writeContractRevisionToDisk(workspacePath, slug, {
                agentId,
                timestamp,
                contentHash,
                title,
                revision,
                content,
            });
        }
        catch {
            diskPath = undefined; // Disk mirror is best-effort; the hub copy is authoritative.
        }
        this.state.contractRevisionBySlug[slug] = revision;
        const contract = {
            agentId,
            content,
            timestamp,
            contentHash,
            revision,
            title,
            service: slug,
            diskPath,
            version: ++this.state.contractVersion,
        };
        this.state.contracts.push(contract);
        this.persist();
        this.emit({ type: "log", data: this.pushLog(agentId, `📋 Posted contract ${slug} rev${revision}.`) });
        return { ok: true, service: slug, revision, contentHash, diskPath, version: contract.version };
    }
    getContracts(sinceVersion) {
        const contracts = sinceVersion && sinceVersion > 0
            ? this.state.contracts.filter((c) => c.version > sinceVersion)
            : this.state.contracts;
        return { contractVersion: this.state.contractVersion, contracts };
    }
    // ── Logs ────────────────────────────────────────────────────────────────────
    pushLog(agentId, message, refs) {
        const entry = { agentId, message, refs, timestamp: nowIso() };
        this.state.logs.push(entry);
        if (this.state.logs.length > MAX_LOGS_IN_MEMORY) {
            this.state.logs.splice(0, this.state.logs.length - MAX_LOGS_IN_MEMORY);
        }
        return entry;
    }
    postUpdate(agentId, message, refs) {
        if (!this.state.active)
            return this.rejection("No active session.");
        const entry = this.pushLog(agentId, message, refs);
        this.persist();
        this.emit({ type: "log", data: entry });
        return { ok: true };
    }
    getLogs() {
        return this.state.logs;
    }
    // ── Checkpoints ─────────────────────────────────────────────────────────────
    postCheckpoint(agentId, summary, nextStep) {
        if (!this.state.active)
            return this.rejection("No active session.");
        if (!this.state.agents.some((a) => a.id === agentId)) {
            return this.rejection(`Unknown agent_id "${agentId}".`);
        }
        const cp = { agentId, summary, nextStep, status: "pending", timestamp: nowIso() };
        this.state.checkpoints[agentId] = cp;
        this.persist();
        this.emit({ type: "checkpoint", data: cp });
        return { ok: true, message: "Checkpoint recorded. Waiting for user decision — poll get_checkpoint_status." };
    }
    resolveCheckpoint(agentId, approved, feedback) {
        const cp = this.state.checkpoints[agentId];
        if (!cp || cp.status !== "pending") {
            return this.rejection(`No pending checkpoint for Agent ${agentId}.`);
        }
        cp.status = approved ? "approved" : "feedback";
        if (feedback) {
            cp.feedback = feedback;
            this.state.lastFeedback = feedback;
        }
        this.state.resumeBriefVersion += 1;
        this.persist();
        this.emit({ type: "checkpoint", data: cp });
        const waiters = this.checkpointWaiters.get(agentId) ?? [];
        this.checkpointWaiters.set(agentId, []);
        for (const w of waiters)
            w();
        return { ok: true };
    }
    getCheckpointStatus(agentId) {
        const cp = this.state.checkpoints[agentId];
        if (!cp)
            return { status: "none" };
        return { status: cp.status, feedback: cp.feedback ?? null };
    }
    /** Optional long-poll: resolves when the pending checkpoint is resolved, or after timeoutMs. */
    awaitCheckpoint(agentId, timeoutMs) {
        const cp = this.state.checkpoints[agentId];
        if (!cp || cp.status !== "pending")
            return Promise.resolve(this.getCheckpointStatus(agentId));
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                const list = this.checkpointWaiters.get(agentId) ?? [];
                this.checkpointWaiters.set(agentId, list.filter((w) => w !== waiter));
                resolve({ ...this.getCheckpointStatus(agentId), pending: true, retry: true });
            }, timeoutMs);
            const waiter = () => {
                clearTimeout(timer);
                resolve(this.getCheckpointStatus(agentId));
            };
            const list = this.checkpointWaiters.get(agentId) ?? [];
            list.push(waiter);
            this.checkpointWaiters.set(agentId, list);
        });
    }
    // ── Views ───────────────────────────────────────────────────────────────────
    resumeBrief(agentId) {
        if (!this.state.active)
            return this.rejection("No active session.");
        if (!this.state.agents.some((a) => a.id === agentId)) {
            return this.rejection(`Unknown agent_id "${agentId}".`);
        }
        return { version: this.state.resumeBriefVersion, brief: buildResumeBrief(this.state, agentId) };
    }
    getStatus() {
        const s = this.state;
        return {
            active: s.active,
            phase: s.phase,
            goal: s.goal,
            mode: s.mode,
            agents: s.agents.map((a) => ({
                ...a,
                registered: !!s.registrations[a.id],
                planPosted: !!s.planProposals[a.id],
                checkpoint: s.checkpoints[a.id] ?? null,
            })),
            boardVersion: s.boardVersion,
            board: {
                total: s.board.length,
                open: s.board.filter((i) => i.status === "open").length,
                claimed: s.board.filter((i) => i.status === "claimed").length,
                done: s.board.filter((i) => i.status === "done").length,
                outOfScope: s.board.filter((i) => i.status === "out-of-scope").length,
            },
            proposedItems: s.proposedBoard.length,
            contractVersion: s.contractVersion,
            logCount: s.logs.length,
            startedAt: s.startedAt,
        };
    }
    sessionBrief(agentId) {
        if (!this.state.active)
            return this.rejection("No active session.");
        const me = this.state.agents.find((a) => a.id === agentId);
        if (!me)
            return this.rejection(`Unknown agent_id "${agentId}".`);
        const peers = this.state.agents
            .filter((a) => a.id !== agentId)
            .map((a) => ({ id: a.id, role: a.role, workspace: a.workspace }));
        return {
            goal: this.state.goal,
            phase: this.state.phase,
            mode: this.state.mode,
            you: { id: me.id, role: me.role, workspace: me.workspace },
            peers,
        };
    }
}
//# sourceMappingURL=store.js.map