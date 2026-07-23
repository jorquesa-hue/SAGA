import { createEventEnvelope, newUuid, type TenantContext, type Uuid } from "@jk/domain-kernel";
import { appendEvent } from "@jk/database";
import type pg from "pg";
import { CALF_REGISTERED } from "./events.js";

/**
 * Port for registering a calf as an animal during calving (JK-REP-006). The
 * Animal Registry context owns animal identity; reproduction depends on this
 * interface — not on the registry package — so the contexts stay decoupled and
 * the calf is created atomically inside the calving transaction.
 *
 * `defaultCalfRegistrar` is the built-in implementation. It is intentionally
 * minimal (insert animal + visual/RFID identifier + animal_registered event)
 * and mirrors the registry's own registration. Extracting a shared
 * AnimalRegistrar owned by @jk/animal-registry is tracked for a later ADR; the
 * composition root may inject that implementation instead.
 */
export interface CalfInput {
  farmId: Uuid;
  visualId: string;
  sex: "female" | "male" | "unknown";
  rfid?: string;
  birthDate: string; // ISO date
  damId: Uuid;
  sireId?: Uuid | null;
  sireExternalRef?: string | null;
}

export interface CalfRegistrar {
  registerCalf(
    client: pg.PoolClient,
    context: TenantContext,
    input: CalfInput,
    options: { environment: string },
  ): Promise<Uuid>;
}

export const defaultCalfRegistrar: CalfRegistrar = {
  async registerCalf(client, context, input, options) {
    const calfId = newUuid();
    await client.query(
      `INSERT INTO animal
         (id, tenant_id, farm_id, visual_id, species_code, breed_code, sex,
          birth_date, birth_date_precision, lifecycle_status, version)
       VALUES ($1,$2,$3,$4,'BOVINE','BRANGUS',$5,$6,'exact','active',1)`,
      [calfId, context.tenantId, input.farmId, input.visualId, input.sex, input.birthDate],
    );
    // Visual identifier.
    await client.query(
      `INSERT INTO animal_identifier
         (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from, assigned_by)
       VALUES ($1,$2,$3,'visual',$4, now(), $5)`,
      [
        newUuid(),
        context.tenantId,
        calfId,
        input.visualId,
        context.actor.type === "user" ? context.actor.id : null,
      ],
    );
    if (input.rfid) {
      await client.query(
        `INSERT INTO animal_identifier
           (id, tenant_id, animal_id, identifier_type, identifier_value, valid_from, assigned_by)
         VALUES ($1,$2,$3,'rfid',$4, now(), $5)`,
        [
          newUuid(),
          context.tenantId,
          calfId,
          input.rfid,
          context.actor.type === "user" ? context.actor.id : null,
        ],
      );
    }
    await appendEvent(
      client,
      createEventEnvelope({
        eventType: CALF_REGISTERED,
        context,
        farmId: input.farmId,
        aggregateType: "animal",
        aggregateId: calfId,
        aggregateVersion: 1,
        source: { channel: "api" },
        idempotencyKey: `calf-register-${calfId}`,
        payload: {
          animalId: calfId,
          farmId: input.farmId,
          visualId: input.visualId,
          sex: input.sex,
          origin: "calving",
          damId: input.damId,
        },
      }),
      { environment: options.environment },
    );
    return calfId;
  },
};
