/**
 * Compatibility re-export. The closed entity-type registry moved to the core
 * `entity-links` module (task 01) so EntityLinksService and SearchService read
 * the same table-to-summary mapping without a core -> module import.
 */
export { ENTITY_REGISTRY, canAccessType, type EntityAdapter } from "../entity-links/entity-registry";
