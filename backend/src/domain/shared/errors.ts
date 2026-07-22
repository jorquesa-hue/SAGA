/**
 * Raised when a domain invariant or business rule is violated.
 * The HTTP layer maps this to a 400/422 response.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

/** Raised when a referenced aggregate does not exist. Maps to 404. */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
