/** The WebSocket gateway. Sockets and validation only — every decision belongs to
 *  {@link CoordinationService}.
 *
 *  Identity is fixed at connect time from the socket's `auth` block, and the network
 *  group is derived from the source IP. Neither can be restated per message: an
 *  envelope claiming to be from someone else is denied, not routed.
 */
import { Logger } from "@nestjs/common";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { WIRE_EVENT, handshakeAuthSchema, makeEnvelope, parseEnvelope } from "@duo/coord-client";
import { BusService } from "./bus/bus.service.js";
import { CoordinationService } from "./coordination.service.js";
import { SessionRegistry } from "./session/session.registry.js";
import { deriveNetworkId, networkOverrideAllowed, normalizeAddress } from "./net/network.js";
import type { Connection } from "./session/session.types.js";

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  // Both machines are on the same LAN; no long-poll fallback needed.
  transports: ["websocket"],
})
export class CoordinationGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger("Gateway");

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly coordination: CoordinationService,
    private readonly bus: BusService,
    private readonly registry: SessionRegistry,
  ) {}

  afterInit(server: Server): void {
    this.bus.attach(server);
    this.log.log("coordination gateway ready");
  }

  handleConnection(socket: Socket): void {
    const auth = handshakeAuthSchema.safeParse(socket.handshake.auth);
    if (!auth.success) {
      this.log.warn(`rejected socket ${socket.id}: bad auth block`);
      socket.emit("connect_rejected", { reason: "invalid auth: expected { userId, displayName, role }" });
      socket.disconnect(true);
      return;
    }

    // One live *agent* socket per user: two processes both draining one queue would
    // break the serialization invariant. Humans may hold several sockets at once — a
    // dashboard and a CLI are the normal case, and neither executes anything.
    //
    // A reconnect from the same machine — or a socket the server hasn't finished
    // reaping — replaces the old one; a *different* machine claiming the same agent
    // identity is a config mistake and is refused.
    const duplicate =
      auth.data.role === "agent"
        ? this.registry.connectionsOf(auth.data.userId).find((existing) => existing.role === "agent")
        : undefined;
    if (duplicate && !this.canReplace(socket, duplicate.socketId)) {
      this.log.warn(`rejected socket ${socket.id}: ${auth.data.userId} already connected as ${auth.data.role}`);
      socket.emit("connect_rejected", { reason: `${auth.data.userId} is already connected as ${auth.data.role}` });
      socket.disconnect(true);
      return;
    }
    if (duplicate) {
      this.log.log(`${auth.data.userId} (${auth.data.role}) reconnected — replacing socket ${duplicate.socketId}`);
      this.server.sockets.sockets.get(duplicate.socketId)?.disconnect(true);
      this.registry.removeConnection(duplicate.socketId);
    }

    const connection: Connection = {
      socketId: socket.id,
      userId: auth.data.userId,
      displayName: auth.data.displayName,
      role: auth.data.role,
      networkId: this.networkIdFor(socket, auth.data.networkIdOverride),
    };
    this.coordination.handleConnect(connection);
  }

  handleDisconnect(socket: Socket): void {
    this.coordination.handleDisconnect(socket.id);
  }

  @SubscribeMessage(WIRE_EVENT)
  onEnvelope(@ConnectedSocket() socket: Socket, @MessageBody() raw: unknown): void {
    const connection = this.registry.connection(socket.id);
    if (!connection) return; // Raced with disconnect.

    const parsed = parseEnvelope(raw);
    if (!parsed.ok) {
      const refId = typeof (raw as { id?: unknown })?.id === "string" ? (raw as { id: string }).id : "unknown";
      this.log.warn(`malformed envelope from ${connection.userId}: ${parsed.error}`);
      socket.emit(
        WIRE_EVENT,
        makeEnvelope("ack", "coordinator", connection.userId, {
          refId,
          status: "denied",
          reason: parsed.error,
        }),
      );
      return;
    }

    this.coordination.handleEnvelope(connection, parsed.envelope);
  }

  /** A stale or same-machine socket may be evicted; one on another host may not. */
  private canReplace(incoming: Socket, existingSocketId: string): boolean {
    const existing = this.server.sockets.sockets.get(existingSocketId);
    if (!existing || !existing.connected) return true;
    return normalizeAddress(existing.handshake.address) === normalizeAddress(incoming.handshake.address);
  }

  /** Source IP only. A client may name its own group solely in dev, when the server
   *  was started with COORD_ALLOW_NETWORK_OVERRIDE=1 (both users on one machine). */
  private networkIdFor(socket: Socket, override: string | undefined): string {
    if (override && networkOverrideAllowed()) return `dev:${override}`;

    const trustProxy = process.env.COORD_TRUST_PROXY === "1";
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    if (trustProxy && forwarded) {
      const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0];
      return deriveNetworkId(first);
    }
    return deriveNetworkId(socket.handshake.address);
  }
}
