import type { JkPlatformClient } from "@jk/contracts-rest";
import type { DeliveryOutcome, OutboxRecord, SyncTransport } from "@jk/offline-sync";

/**
 * SyncTransport that delivers captured observations to the platform's
 * idempotent batch endpoint (POST /api/v1/device-observations:batch). The
 * server dedupes on `observationId` (= the outbox record id = idempotency key),
 * so re-delivery is safe. The 207 per-observation result maps to the engine's
 * outcomes:
 *   accepted | duplicate | pending_resolution  → accepted (server has it)
 *   rejected_validation                         → rejected (park for review)
 *   retryable_error / missing                   → retryable
 *
 * Only observation records are handled here; command records would use a
 * sibling transport. A record with no matching server result is defensively
 * treated as retryable so nothing is ever assumed delivered.
 */
export class HttpSyncTransport implements SyncTransport {
  constructor(private readonly client: JkPlatformClient) {}

  async deliver(records: OutboxRecord[]): Promise<DeliveryOutcome[]> {
    const observations = records.map((r) => ({ ...r.payload, observationId: r.id }));
    const { results } = await this.client.devices.ingestBatch(observations);
    const byId = new Map(results.map((res) => [res.observationId, res]));

    return records.map((r): DeliveryOutcome => {
      const res = byId.get(r.id);
      if (!res) return { id: r.id, outcome: "retryable", error: "no_result_returned" };
      switch (res.status) {
        case "accepted":
        case "duplicate":
        case "pending_resolution":
          return { id: r.id, outcome: "accepted", serverId: res.serverObservationId ?? undefined };
        case "rejected_validation":
          return { id: r.id, outcome: "rejected", error: res.reason ?? "rejected_validation" };
        default:
          return { id: r.id, outcome: "retryable", error: res.reason ?? res.status };
      }
    });
  }
}
