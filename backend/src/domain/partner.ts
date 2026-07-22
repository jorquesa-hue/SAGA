import { DomainError } from "./shared/errors.js";
import { newId, type Id } from "./shared/ids.js";

export type PartnerKind = "customer" | "supplier" | "both";

export interface PartnerProps {
  id: Id;
  organizationId: Id;
  name: string;
  kind: PartnerKind;
  taxId?: string;
  email?: string;
}

export interface CreatePartnerInput {
  organizationId: Id;
  name: string;
  kind: PartnerKind;
  taxId?: string;
  email?: string;
}

/**
 * Partner (Tercero) — a business partner: customer, supplier, or both.
 * Invariants:
 *  - name is non-empty
 *  - kind is valid
 *  - email, if present, looks like an email
 */
export class Partner {
  private constructor(private props: PartnerProps) {}

  static create(input: CreatePartnerInput): Partner {
    const name = input.name?.trim();
    if (!input.organizationId) throw new DomainError("organizationId is required");
    if (!name) throw new DomainError("Partner name is required");
    if (!["customer", "supplier", "both"].includes(input.kind)) {
      throw new DomainError("kind must be 'customer', 'supplier' or 'both'");
    }
    const email = input.email?.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new DomainError("email is not valid");
    }

    return new Partner({
      id: newId(),
      organizationId: input.organizationId,
      name,
      kind: input.kind,
      taxId: input.taxId?.trim() || undefined,
      email: email || undefined,
    });
  }

  static fromProps(props: PartnerProps): Partner {
    return new Partner(props);
  }

  get id(): Id {
    return this.props.id;
  }
  get organizationId(): Id {
    return this.props.organizationId;
  }

  toJSON(): PartnerProps {
    return { ...this.props };
  }
}
