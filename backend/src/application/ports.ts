import type { Farm } from "../domain/farm.js";
import type { Parcel } from "../domain/parcel.js";
import type { CropCycle } from "../domain/cropCycle.js";
import type { Partner } from "../domain/partner.js";
import type { Id } from "../domain/shared/ids.js";

/**
 * Repository ports. The application layer depends on these interfaces only,
 * never on concrete adapters — so persistence (in-memory now, PostgreSQL later)
 * can be swapped without touching business logic.
 *
 * All reads are scoped by organizationId to enforce tenant isolation.
 */

export interface FarmRepository {
  save(farm: Farm): Promise<void>;
  findById(organizationId: Id, id: Id): Promise<Farm | null>;
  listByOrganization(organizationId: Id): Promise<Farm[]>;
}

export interface ParcelRepository {
  save(parcel: Parcel): Promise<void>;
  findById(organizationId: Id, id: Id): Promise<Parcel | null>;
  listByFarm(organizationId: Id, farmId: Id): Promise<Parcel[]>;
}

export interface CropCycleRepository {
  save(cycle: CropCycle): Promise<void>;
  findById(organizationId: Id, id: Id): Promise<CropCycle | null>;
  listByParcel(organizationId: Id, parcelId: Id): Promise<CropCycle[]>;
}

export interface PartnerRepository {
  save(partner: Partner): Promise<void>;
  findById(organizationId: Id, id: Id): Promise<Partner | null>;
  listByOrganization(organizationId: Id): Promise<Partner[]>;
}

export interface Repositories {
  farms: FarmRepository;
  parcels: ParcelRepository;
  cropCycles: CropCycleRepository;
  partners: PartnerRepository;
}
