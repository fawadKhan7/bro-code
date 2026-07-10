import { loadSession, removeInjectedRule, saveSession, emptySession } from "@conductor/shared";

export function cmdStop(): void {
  const s = loadSession();
  if (s.pathA) removeInjectedRule(s.pathA);
  if (s.pathB) removeInjectedRule(s.pathB);
  saveSession(emptySession());
  console.log("Conductor session stopped. Injected rules removed.");
}
