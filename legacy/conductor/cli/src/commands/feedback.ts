import { applyFeedback, loadSession } from "@conductor/shared";

export function cmdFeedback(message: string | null): void {
  const s = loadSession();
  if (!s.active) {
    console.error("No active session.");
    process.exit(1);
  }

  applyFeedback(s, message);
  const updated = loadSession();

  console.log("Checkpoint cleared. Agents may call get_resume_brief.\n");
  if (message) console.log(`Feedback: ${message}\n`);
  if (updated.resumeBrief) {
    console.log("--- Resume brief preview ---\n");
    console.log(updated.resumeBrief);
    console.log("\n--- end ---");
  }
}
