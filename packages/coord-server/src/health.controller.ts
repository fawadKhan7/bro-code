/** Liveness + a coarse view of what the coordinator is holding. Useful when two
 *  machines disagree about whether the server is reachable at all. */
import { Controller, Get } from "@nestjs/common";
import { PresenceService } from "./presence/presence.service.js";
import { SessionRegistry } from "./session/session.registry.js";

@Controller()
export class HealthController {
  constructor(
    private readonly presence: PresenceService,
    private readonly registry: SessionRegistry,
  ) {}

  @Get("health")
  health() {
    const networks = this.presence.networks();
    return {
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      networks: networks.map((networkId) => ({ networkId, roster: this.presence.roster(networkId) })),
      sessions: this.registry.all().map((session) => ({
        sessionId: session.sessionId,
        participants: session.participants,
        startedAt: session.startedAt,
      })),
    };
  }
}
