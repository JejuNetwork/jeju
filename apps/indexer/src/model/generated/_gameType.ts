/**
 * Game types for TEE attestations
 * GENERIC should be used for new games. Specific game types are legacy
 * and will be deprecated in favor of dynamic registration.
 */
export enum GameType {
    GENERIC = "GENERIC",
    // Legacy game types (retained for backwards compatibility)
    CALIGULAND = "CALIGULAND",
    EHORSE = "EHORSE",
    HYPERSCAPE = "HYPERSCAPE",
}
