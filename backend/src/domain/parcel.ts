import { DomainError } from "./shared/errors.js";
import { newId, type Id } from "./shared/ids.js";

export type Irrigation = "rainfed" | "irrigated";

export interface ParcelProps {
  id: Id;
  organizationId: Id;
  farmId: Id;
  code: string;
  areaHa: number;
  sigpacRef?: string;
  irrigation: Irrigation;
}

export interface CreateParcelInput {
  organizationId: Id;
  farmId: Id;
  code: string;
  areaHa: number;
  sigpacRef?: string;
  irrigation?: Irrigation;
}

/**
 * Parcel (Parcela / Lote) — a delimited piece of land within a farm.
 * Invariants:
 *  - code is non-empty
 *  - areaHa > 0
 *  - irrigation is one of the allowed values
 */
export class Parcel {
  private constructor(private props: ParcelProps) {}

  static create(input: CreateParcelInput): Parcel {
    const code = input.code?.trim();
    if (!input.organizationId) throw new DomainError("organizationId is required");
    if (!input.farmId) throw new DomainError("farmId is required");
    if (!code) throw new DomainError("Parcel code is required");
    if (typeof input.areaHa !== "number" || Number.isNaN(input.areaHa)) {
      throw new DomainError("areaHa must be a number");
    }
    if (input.areaHa <= 0) throw new DomainError("areaHa must be greater than 0");

    const irrigation = input.irrigation ?? "rainfed";
    if (irrigation !== "rainfed" && irrigation !== "irrigated") {
      throw new DomainError("irrigation must be 'rainfed' or 'irrigated'");
    }

    return new Parcel({
      id: newId(),
      organizationId: input.organizationId,
      farmId: input.farmId,
      code,
      areaHa: input.areaHa,
      sigpacRef: input.sigpacRef?.trim() || undefined,
      irrigation,
    });
  }

  static fromProps(props: ParcelProps): Parcel {
    return new Parcel(props);
  }

  get id(): Id {
    return this.props.id;
  }
  get organizationId(): Id {
    return this.props.organizationId;
  }
  get farmId(): Id {
    return this.props.farmId;
  }
  get areaHa(): number {
    return this.props.areaHa;
  }

  toJSON(): ParcelProps {
    return { ...this.props };
  }
}
