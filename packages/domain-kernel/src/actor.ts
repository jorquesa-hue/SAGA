import { ValidationError } from "./errors.js";

/**
 * Actor and source context (JK-PLT-EES-001 §39, JK-CON-010).
 * Every recorded fact identifies who/what produced it.
 */

export type ActorType = "user" | "device" | "service" | "agent";

export interface ActorContext {
  type: ActorType;
  id: string;
  /** Optional display snapshot at recording time (denormalized on purpose). */
  display?: string;
}

export type SourceChannel = "web" | "mobile" | "edge" | "import" | "api" | "system";

export interface SourceContext {
  channel: SourceChannel;
  deviceId?: string | null;
  appVersion?: string | null;
}

const ACTOR_TYPES: readonly ActorType[] = ["user", "device", "service", "agent"];
const CHANNELS: readonly SourceChannel[] = [
  "web",
  "mobile",
  "edge",
  "import",
  "api",
  "system",
];

export function assertActor(actor: ActorContext): void {
  if (!ACTOR_TYPES.includes(actor.type)) {
    throw new ValidationError(`Unknown actor type '${actor.type}'`);
  }
  if (!actor.id || !actor.id.trim()) {
    throw new ValidationError("Actor id is required");
  }
}

export function assertSource(source: SourceContext): void {
  if (!CHANNELS.includes(source.channel)) {
    throw new ValidationError(`Unknown source channel '${source.channel}'`);
  }
}
