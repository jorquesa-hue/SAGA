import { Farm, type CreateFarmInput } from "../domain/farm.js";
import { Parcel, type CreateParcelInput } from "../domain/parcel.js";
import { CropCycle, type CropStatus } from "../domain/cropCycle.js";
import { Partner, type CreatePartnerInput } from "../domain/partner.js";
import { NotFoundError } from "../domain/shared/errors.js";
import type { Id } from "../domain/shared/ids.js";
import type { Repositories } from "./ports.js";

/**
 * Use cases orchestrate domain objects and repositories. They contain no
 * framework or transport concerns.
 */
export class SagaService {
  constructor(private readonly repos: Repositories) {}

  // ---- Farms ----
  async createFarm(input: CreateFarmInput): Promise<Farm> {
    const farm = Farm.create(input);
    await this.repos.farms.save(farm);
    return farm;
  }

  async listFarms(organizationId: Id): Promise<Farm[]> {
    return this.repos.farms.listByOrganization(organizationId);
  }

  // ---- Parcels ----
  async registerParcel(input: CreateParcelInput): Promise<Parcel> {
    const farm = await this.repos.farms.findById(input.organizationId, input.farmId);
    if (!farm) throw new NotFoundError(`Farm ${input.farmId} not found`);
    const parcel = Parcel.create(input);
    await this.repos.parcels.save(parcel);
    return parcel;
  }

  async listParcels(organizationId: Id, farmId: Id): Promise<Parcel[]> {
    return this.repos.parcels.listByFarm(organizationId, farmId);
  }

  // ---- Crop cycles ----
  async openCropCycle(input: {
    organizationId: Id;
    parcelId: Id;
    crop: string;
    variety?: string;
    cultivatedAreaHa: number;
    plannedSowing?: string;
    plannedHarvest?: string;
  }): Promise<CropCycle> {
    const parcel = await this.repos.parcels.findById(input.organizationId, input.parcelId);
    if (!parcel) throw new NotFoundError(`Parcel ${input.parcelId} not found`);

    const cycle = CropCycle.create({
      organizationId: input.organizationId,
      parcelId: input.parcelId,
      parcelAreaHa: parcel.areaHa,
      crop: input.crop,
      variety: input.variety,
      cultivatedAreaHa: input.cultivatedAreaHa,
      plannedSowing: input.plannedSowing,
      plannedHarvest: input.plannedHarvest,
    });
    await this.repos.cropCycles.save(cycle);
    return cycle;
  }

  async advanceCropCycle(organizationId: Id, id: Id, status: CropStatus): Promise<CropCycle> {
    const cycle = await this.repos.cropCycles.findById(organizationId, id);
    if (!cycle) throw new NotFoundError(`Crop cycle ${id} not found`);
    cycle.advanceTo(status);
    await this.repos.cropCycles.save(cycle);
    return cycle;
  }

  async listCropCycles(organizationId: Id, parcelId: Id): Promise<CropCycle[]> {
    return this.repos.cropCycles.listByParcel(organizationId, parcelId);
  }

  // ---- Partners ----
  async createPartner(input: CreatePartnerInput): Promise<Partner> {
    const partner = Partner.create(input);
    await this.repos.partners.save(partner);
    return partner;
  }

  async listPartners(organizationId: Id): Promise<Partner[]> {
    return this.repos.partners.listByOrganization(organizationId);
  }
}
