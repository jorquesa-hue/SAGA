import { randomUUID } from "node:crypto";
import { monotonicFactory } from "ulid";

/** Opaque UUID string used for aggregate identifiers. */
export type Uuid = string;

/** Opaque ULID string used for event and message identifiers (sortable). */
export type Ulid = string;

const ulidGenerator = monotonicFactory();

export const newUuid = (): Uuid => randomUUID();

/** Monotonic ULID — sortable within a process, suitable for event IDs. */
export const newUlid = (): Ulid => ulidGenerator();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const isUuid = (value: string): boolean => UUID_RE.test(value);
export const isUlid = (value: string): boolean => ULID_RE.test(value);
