import type {
  FarmRepository,
  ParcelRepository,
  CropCycleRepository,
  PartnerRepository,
  Repositories,
} from "../../application/ports.js";
import type { Farm } from "../../domain/farm.js";
import type { Parcel } from "../../domain/parcel.js";
import type { CropCycle } from "../../domain/cropCycle.js";
import type { Partner } from "../../domain/partner.js";
import type { Id } from "../../domain/shared/ids.js";

/**
 * In-memory adapters. Used for tests and for the initial runnable slice.
 * A PostgreSQL implementation of the same ports will replace these in Phase 1.
 */

class InMemoryFarmRepository implements FarmRepository {
  private store = new Map<Id, Farm>();
  async save(farm: Farm): Promise<void> {
    this.store.set(farm.id, farm);
  }
  async findById(organizationId: Id, id: Id): Promise<Farm | null> {
    const f = this.store.get(id);
    return f && f.organizationId === organizationId ? f : null;
  }
  async listByOrganization(organizationId: Id): Promise<Farm[]> {
    return [...this.store.values()].filter((f) => f.organizationId === organizationId);
  }
}

class InMemoryParcelRepository implements ParcelRepository {
  private store = new Map<Id, Parcel>();
  async save(parcel: Parcel): Promise<void> {
    this.store.set(parcel.id, parcel);
  }
  async findById(organizationId: Id, id: Id): Promise<Parcel | null> {
    const p = this.store.get(id);
    return p && p.organizationId === organizationId ? p : null;
  }
  async listByFarm(organizationId: Id, farmId: Id): Promise<Parcel[]> {
    return [...this.store.values()].filter(
      (p) => p.organizationId === organizationId && p.farmId === farmId,
    );
  }
}

class InMemoryCropCycleRepository implements CropCycleRepository {
  private store = new Map<Id, CropCycle>();
  async save(cycle: CropCycle): Promise<void> {
    this.store.set(cycle.id, cycle);
  }
  async findById(organizationId: Id, id: Id): Promise<CropCycle | null> {
    const c = this.store.get(id);
    return c && c.toJSON().organizationId === organizationId ? c : null;
  }
  async listByParcel(organizationId: Id, parcelId: Id): Promise<CropCycle[]> {
    return [...this.store.values()].filter(
      (c) => c.toJSON().organizationId === organizationId && c.parcelId === parcelId,
    );
  }
}

class InMemoryPartnerRepository implements PartnerRepository {
  private store = new Map<Id, Partner>();
  async save(partner: Partner): Promise<void> {
    this.store.set(partner.id, partner);
  }
  async findById(organizationId: Id, id: Id): Promise<Partner | null> {
    const p = this.store.get(id);
    return p && p.organizationId === organizationId ? p : null;
  }
  async listByOrganization(organizationId: Id): Promise<Partner[]> {
    return [...this.store.values()].filter((p) => p.organizationId === organizationId);
  }
}

export function createInMemoryRepositories(): Repositories {
  return {
    farms: new InMemoryFarmRepository(),
    parcels: new InMemoryParcelRepository(),
    cropCycles: new InMemoryCropCycleRepository(),
    partners: new InMemoryPartnerRepository(),
  };
}
