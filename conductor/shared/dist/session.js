"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptySession = emptySession;
exports.loadSession = loadSession;
exports.saveSession = saveSession;
exports.updateSession = updateSession;
exports.appendUpdate = appendUpdate;
exports.getContractDelta = getContractDelta;
exports.applyFeedback = applyFeedback;
exports.setCheckpoint = setCheckpoint;
exports.peerId = peerId;
const fs = __importStar(require("fs"));
const paths_1 = require("./paths");
const contractFormat_1 = require("./contractFormat");
const resumeBrief_1 = require("./resumeBrief");
function emptySession() {
    return {
        active: false,
        goal: "",
        preset: "frontend-backend",
        pathA: "",
        pathB: "",
        briefA: "",
        briefB: "",
        injectedRuleA: "",
        injectedRuleB: "",
        contractVersion: 0,
        updates: [],
        checkpointA: null,
        checkpointB: null,
        checkpointPhase: "idle",
        lastFeedback: null,
        resumeBriefVersion: 0,
        resumeBrief: null,
        startedAt: "",
    };
}
function loadSession() {
    try {
        const raw = fs.readFileSync((0, paths_1.sessionPath)(), "utf8");
        return { ...emptySession(), ...JSON.parse(raw) };
    }
    catch {
        return emptySession();
    }
}
function saveSession(session) {
    fs.mkdirSync((0, paths_1.conductorHome)(), { recursive: true });
    fs.writeFileSync((0, paths_1.sessionPath)(), JSON.stringify(session, null, 2), "utf8");
}
function updateSession(mutator) {
    const session = loadSession();
    mutator(session);
    saveSession(session);
    return session;
}
function appendUpdate(session, input) {
    const version = session.contractVersion + 1;
    const entry = {
        ...input,
        version,
        timestamp: new Date().toISOString(),
    };
    session.contractVersion = version;
    session.updates.push(entry);
    return entry;
}
function getContractDelta(session, sinceVersion) {
    const slice = session.updates.filter((u) => u.version > sinceVersion);
    return (0, contractFormat_1.formatContractLines)(slice);
}
function applyFeedback(session, feedback) {
    const msg = feedback?.trim() ?? "";
    session.lastFeedback = msg || null;
    session.checkpointPhase = "resumed";
    if (session.checkpointA?.status === "pending")
        session.checkpointA.status = "approved";
    if (session.checkpointB?.status === "pending")
        session.checkpointB.status = "approved";
    session.resumeBriefVersion += 1;
    session.resumeBrief = (0, resumeBrief_1.buildResumeBrief)(session, msg || null);
    saveSession(session);
}
function setCheckpoint(session, agentId, summary, nextStep) {
    const cp = {
        summary,
        nextStep,
        status: "pending",
        timestamp: new Date().toISOString(),
    };
    if (agentId === "agent-a")
        session.checkpointA = cp;
    else
        session.checkpointB = cp;
    session.checkpointPhase = "waiting_user";
}
function peerId(agentId) {
    return agentId === "agent-a" ? "agent-b" : "agent-a";
}
//# sourceMappingURL=session.js.map