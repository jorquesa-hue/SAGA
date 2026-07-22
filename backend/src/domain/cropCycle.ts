import { DomainError } from "./shared/errors.js";
import { newId, type Id } from "./shared/ids.js";

export type CropStatus = "planned" | "active" | "harvested" | "closed";

const STATUS_ORDER: CropStatus[] = ["planned", "active", "harvested", "closed"];

export interface CropCycleProps {
  id: Id;
  organizationId: Id;
  parcelId: Id;
  crop: string;
  variety?: string;
  cultivatedAreaHa: number;
  plannedSowing?: string; // ISO date
  plannedHarvest?: string; // ISO date
  status: CropStatus;
}

export interface CreateCropCycleInput {
  organizationId: Id;
  parcelId: Id;
  parcelAreaHa: number; // supplied by the use case for the area invariant
  crop: string;
  variety?: string;
  cultivatedAreaHa: number;
  plannedSowing?: string;
  plannedHarvest?: string;
}

/**
 * CropCycle (Campaña de cultivo) — a crop grown on a parcel for a season.
 * Invariants:
 *  - crop is non-empty
 *  - 0 < cultivatedAreaHa <= parcel area
 *  - status transitions only move forward: planned → active → harvested → closed
 */
export class CropCycle {
  private constructor(private props: CropCycleProps) {}

  static create(input: CreateCropCycleInput): CropCycle {
    const crop = input.crop?.trim();
    if (!input.organizationId) throw new DomainError("organizationId is required");
    if (!input.parcelId) throw new DomainError("parcelId is required");
    if (!crop) throw new DomainError("crop is required");
    if (typeof input.cultivatedAreaHa !== "number" || Number.isNaN(input.cultivatedAreaHa)) {
      throw new DomainError("cultivatedAreaHa must be a number");
    }
    if (input.cultivatedAreaHa <= 0) {
      throw new DomainError("cultivatedAreaHa must be greater than 0");
    }
    if (input.cultivatedAreaHa > input.parcelAreaHa) {
      throw new DomainError(
        `cultivatedAreaHa (${input.cultivatedAreaHa}) cannot exceed parcel area (${input.parcelAreaHa})`,
      );
    }

    return new CropCycle({
      id: newId(),
      organizationId: input.organizationId,
      parcelId: input.parcelId,
      crop,
      variety: input.variety?.trim() || undefined,
      cultivatedAreaHa: input.cultivatedAreaHa,
      plannedSowing: input.plannedSowing,
      plannedHarvest: input.plannedHarvest,
      status: "planned",
    });
  }

  static fromProps(props: CropCycleProps): CropCycle {
    return new CropCycle(props);
  }

  /**
   * Advance the crop cycle to a new status.
   * Only forward transitions along planned → active → harvested → closed are allowed.
   */
  advanceTo(next: CropStatus): void {
    const currentIdx = STATUS_ORDER.indexOf(this.props.status);
    const nextIdx = STATUS_ORDER.indexOf(next);
    if (nextIdx === -1) throw new DomainError(`Unknown status '${next}'`);
    if (nextIdx <= currentIdx) {
      throw new DomainError(
        `Cannot move crop cycle from '${this.props.status}' to '${next}'`,
      );
    }
    this.props.status = next;
  }

  get id(): Id {
    return this.props.id;
  }
  get status(): CropStatus {
    return this.props.status;
  }
  get parcelId(): Id {
    return this.props.parcelId;
  }

  toJSON(): CropCycleProps {
    return { ...this.props };
  }
}
