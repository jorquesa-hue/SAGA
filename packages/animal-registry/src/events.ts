/**
 * Canonical Animal Registry event types (§9.2, §39). Past-tense, versioned.
 * Additional lifecycle events (purchased, sold, mortality, status_corrected)
 * arrive with their workflows in later slices.
 */
export const ANIMAL_REGISTERED = "animal.animal_registered.v1";
export const IDENTIFIER_ASSIGNED = "animal.identifier_assigned.v1";
export const IDENTIFIER_REPLACED = "animal.identifier_replaced.v1";
export const PHOTO_ADDED = "animal.photo_added.v1";
export const PHOTO_REMOVED = "animal.photo_removed.v1";
