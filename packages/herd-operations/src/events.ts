/**
 * Herd Operations event types (§39). Weight is an animal fact; session
 * lifecycle facts are handling_session aggregate events.
 */
export const WEIGHT_RECORDED = "animal.weight_recorded.v1";
export const SESSION_STARTED = "herd.handling_session_started.v1";
export const SESSION_CLOSED = "herd.handling_session_closed.v1";
export const OBSERVATION_REVIEWED = "herd.observation_reviewed.v1";
