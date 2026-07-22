import { DomainError } from "./shared/errors.js";
import { newId, type Id } from "./shared/ids.js";

export interface FarmProps {
  id: Id;
  organizationId: Id;
  name: string;
  totalAreaHa: number;
  municipality?: string;
  province?: string;
}

export interface CreateFarmInput {
  organizationId: Id;
  name: string;
  totalAreaHa: number;
  municipality?: string;
  province?: string;
}

/**
 * Farm (Explotación / Finca) — a production unit.
 * Invariants:
 *  - name is non-empty
 *  - totalAreaHa >= 0
 */
export class Farm {
  private constructor(private props: FarmProps) {}

  static create(input: CreateFarmInput): Farm {
    const name = input.name?.trim();
    if (!name) throw new DomainError("Farm name is required");
    if (!input.organizationId) throw new DomainError("organizationId is required");
    if (typeof input.totalAreaHa !== "number" || Number.isNaN(input.totalAreaHa)) {
      throw new DomainError("totalAreaHa must be a number");
    }
    if (input.totalAreaHa < 0) throw new DomainError("totalAreaHa cannot be negative");

    return new Farm({
      id: newId(),
      organizationId: input.organizationId,
      name,
      totalAreaHa: input.totalAreaHa,
      municipality: input.municipality?.trim() || undefined,
      province: input.province?.trim() || undefined,
    });
  }

  /** Rehydrate from persistence without re-running creation-time side effects. */
  static fromProps(props: FarmProps): Farm {
    return new Farm(props);
  }

  get id(): Id {
    return this.props.id;
  }
  get organizationId(): Id {
    return this.props.organizationId;
  }
  get name(): string {
    return this.props.name;
  }
  get totalAreaHa(): number {
    return this.props.totalAreaHa;
  }

  toJSON(): FarmProps {
    return { ...this.props };
  }
}
