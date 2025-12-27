
package conf

// This parameters should be kept consistent in all BPs.
const (
	DefaultConfirmThreshold = float64(2) / 3.0
)

// These parameters will not cause inconsistency within certain range.
const (
	BPStartupRequiredReachableCount = 2 // NOTE: this includes myself
)

// Block producer chain improvements proposal heights.
const (
	BPHeightCIPFixProvideService = 675550 // inclusive, in 2019-5-15 16:11:40 +08:00
)
