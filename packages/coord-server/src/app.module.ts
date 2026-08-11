import { Module } from "@nestjs/common";
import { BusService } from "./bus/bus.service.js";
import { ContractService } from "./contract/contract.service.js";
import { CoordinationGateway } from "./coordination.gateway.js";
import { CoordinationService } from "./coordination.service.js";
import { HandshakeService } from "./handshake/handshake.service.js";
import { HealthController } from "./health.controller.js";
import { LockService } from "./lock/lock.service.js";
import { PairingService } from "./pairing/pairing.service.js";
import { PresenceService } from "./presence/presence.service.js";
import { QueueService } from "./queue/queue.service.js";
import { SessionRegistry } from "./session/session.registry.js";

/** The umbrella host: one process owning presence, sessions, queues and locks.
 *  Everything is in-memory and single-instance by design — this coordinates a
 *  handful of people on one LAN, not a cluster. */
@Module({
  controllers: [HealthController],
  providers: [
    SessionRegistry,
    BusService,
    PresenceService,
    PairingService,
    LockService,
    QueueService,
    HandshakeService,
    ContractService,
    CoordinationService,
    CoordinationGateway,
  ],
  exports: [CoordinationService],
})
export class AppModule {}
