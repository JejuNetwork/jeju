/**
 * Relation ID helper for TypeORM
 *
 * This file is separated from entities.ts to allow importing relationId
 * without triggering TypeORM model loading.
 */

// Opaque type for relation references - TypeORM only needs the ID
declare const RelationRefBrand: unique symbol
type RelationRef<T> = T & { readonly [RelationRefBrand]?: never }

/**
 * Helper for TypeORM relations where only the ID is needed.
 * TypeORM handles the relation by the ID, so we only need to provide the ID field.
 * Returns a properly typed relation reference that TypeORM will resolve.
 */
export function relationId<T extends { id: string }>(id: string): RelationRef<T> {
  // At runtime, TypeORM only needs the ID to establish relations
  // This function creates a minimal object that satisfies the relation
  return { id } as RelationRef<T>
}

