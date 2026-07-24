import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook payload signing (§51). The signature covers a replay-protection
 * timestamp, the per-delivery id, and the exact JSON body. Consumers recompute
 * the HMAC and reject stale timestamps. Secret rotation supports an overlap:
 * `verifySignature` accepts either the current or the previous secret so a
 * consumer can roll its secret without dropping in-flight deliveries.
 *
 * Header layout (sent to the consumer):
 *   X-JK-Delivery-Id: <uuid>
 *   X-JK-Event:       <event_type>
 *   X-JK-Timestamp:   <unix-seconds>
 *   X-JK-Signature:   v1=<hex-hmac-sha256>
 */

export const SIGNATURE_HEADER = "x-jk-signature";
export const TIMESTAMP_HEADER = "x-jk-timestamp";
export const DELIVERY_HEADER = "x-jk-delivery-id";
export const EVENT_HEADER = "x-jk-event";

/** Default replay window: reject signatures older than 5 minutes. */
export const DEFAULT_REPLAY_TOLERANCE_SECONDS = 300;

function signingBase(timestamp: number, deliveryId: string, body: string): string {
  return `${timestamp}.${deliveryId}.${body}`;
}

function hmac(secret: string, base: string): string {
  return createHmac("sha256", secret).update(base).digest("hex");
}

export interface SignedDelivery {
  timestamp: number;
  signature: string;
  headers: Record<string, string>;
}

/**
 * Sign a delivery with the subscription's CURRENT secret. `timestampSeconds`
 * is injected (the caller stamps the current time) so this stays pure and
 * deterministic in tests.
 */
export function signDelivery(params: {
  secret: string;
  deliveryId: string;
  eventType: string;
  body: string;
  timestampSeconds: number;
}): SignedDelivery {
  const base = signingBase(params.timestampSeconds, params.deliveryId, params.body);
  const signature = `v1=${hmac(params.secret, base)}`;
  return {
    timestamp: params.timestampSeconds,
    signature,
    headers: {
      [DELIVERY_HEADER]: params.deliveryId,
      [EVENT_HEADER]: params.eventType,
      [TIMESTAMP_HEADER]: String(params.timestampSeconds),
      [SIGNATURE_HEADER]: signature,
    },
  };
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify a signature against the current secret and, if present, the previous
 * (rotation-overlap) secret. Enforces the replay window when `nowSeconds` is
 * supplied. Returns which secret matched (or null).
 */
export function verifySignature(params: {
  secret: string;
  secretPrevious?: string | null;
  deliveryId: string;
  body: string;
  timestampSeconds: number;
  signature: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): { valid: boolean; matched: "current" | "previous" | null; reason?: string } {
  if (params.nowSeconds !== undefined) {
    const tolerance = params.toleranceSeconds ?? DEFAULT_REPLAY_TOLERANCE_SECONDS;
    if (Math.abs(params.nowSeconds - params.timestampSeconds) > tolerance) {
      return { valid: false, matched: null, reason: "timestamp_outside_replay_window" };
    }
  }
  const base = signingBase(params.timestampSeconds, params.deliveryId, params.body);
  const expectedCurrent = `v1=${hmac(params.secret, base)}`;
  if (safeEqualHex(params.signature, expectedCurrent)) {
    return { valid: true, matched: "current" };
  }
  if (params.secretPrevious) {
    const expectedPrevious = `v1=${hmac(params.secretPrevious, base)}`;
    if (safeEqualHex(params.signature, expectedPrevious)) {
      return { valid: true, matched: "previous" };
    }
  }
  return { valid: false, matched: null, reason: "signature_mismatch" };
}
