import { EventEmitter } from "node:events";
import { Injectable } from "@nestjs/common";
import type { EventMessage } from "@events/contracts";

/**
 * In-process hand-off from the team chat to the PTT bridges.
 *
 * It exists purely to break a dependency cycle: the bridge needs EventChat to
 * post inbound traffic, and EventChat needs the bridge to relay outbound
 * traffic. Both depend on this instead — it lives in the global infra module,
 * so neither has to import the other.
 *
 * Deliberately in-process rather than over Redis: the bridge holds a single
 * long-lived socket per network, so only the process that owns that socket can
 * transmit anyway.
 */
@Injectable()
export class PttBusService {
  private readonly emitter = new EventEmitter();

  constructor() {
    // A bridge outage must never take down chat delivery.
    this.emitter.setMaxListeners(20);
    this.emitter.on("error", () => undefined);
  }

  /** Called by EventChatService for every message written *in the app*. */
  publishOutbound(message: EventMessage): void {
    this.emitter.emit("outbound", message);
  }

  onOutbound(listener: (message: EventMessage) => void): void {
    this.emitter.on("outbound", listener);
  }
}
