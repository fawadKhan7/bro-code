/** The contract broadcaster.
 *
 *  The API contract is the coordination boundary between the two agents: an endpoint
 *  change is the thing that has to cross, whoever happens to make it. Latest version
 *  per endpoint wins; the peer agent consumes the broadcast and stays loosely coupled.
 */
import { Injectable, Logger } from "@nestjs/common";
import type { ContractPayload } from "@duo/coord-client";
import type { AgentRef } from "../session/session.types.js";

const endpointKey = (contract: ContractPayload) => `${contract.method} ${contract.endpoint}`;

@Injectable()
export class ContractService {
  private readonly log = new Logger("Contracts");
  /** sessionId -> "METHOD /path" -> latest. */
  private readonly published = new Map<string, Map<string, ContractPayload>>();

  publish(sessionId: string, contract: ContractPayload, from: AgentRef): ContractPayload {
    let bySession = this.published.get(sessionId);
    if (!bySession) {
      bySession = new Map();
      this.published.set(sessionId, bySession);
    }
    bySession.set(endpointKey(contract), contract);
    this.log.log(
      `${from} published ${endpointKey(contract)} v${contract.version}${contract.breaking ? " (breaking)" : ""}`,
    );
    return contract;
  }

  list(sessionId: string): ContractPayload[] {
    const bySession = this.published.get(sessionId);
    if (!bySession) return [];
    return [...bySession.values()].sort((a, b) => endpointKey(a).localeCompare(endpointKey(b)));
  }

  disposeSession(sessionId: string): void {
    this.published.delete(sessionId);
  }
}
