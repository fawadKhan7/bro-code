import { formatContractLines } from "@conductor/shared";
import { loadSession } from "@conductor/shared";

export function cmdStatus(): void {
  const s = loadSession();
  if (!s.active) {
    console.log("No active session. Run: conductor start \"<goal>\"");
    return;
  }

  console.log("Conductor session\n");
  console.log(`  Goal:      ${s.goal}`);
  console.log(`  Preset:    ${s.preset}`);
  console.log(`  Phase:     ${s.checkpointPhase}`);
  console.log(`  Contract:  v${s.contractVersion}`);
  console.log(`  Started:   ${s.startedAt}`);
  console.log(`  Agent A:   ${s.pathA}`);
  console.log(`  Agent B:   ${s.pathB}`);

  if (s.checkpointA) {
    console.log(`\n  Checkpoint A [${s.checkpointA.status}]: ${s.checkpointA.summary}`);
    console.log(`    Next: ${s.checkpointA.nextStep}`);
  }
  if (s.checkpointB) {
    console.log(`\n  Checkpoint B [${s.checkpointB.status}]: ${s.checkpointB.summary}`);
    console.log(`    Next: ${s.checkpointB.nextStep}`);
  }

  const recent = s.updates.slice(-6);
  if (recent.length) {
    console.log("\n  Recent updates:\n");
    console.log(
      formatContractLines(recent)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n")
    );
  }
}
