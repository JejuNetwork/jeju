// +build !go1.11


package trace

import (
	"context"
	"io"
)

// Task mocks runtime/trace.Task.
type Task struct{}

// End mocks runtime/trace.Task.End.
func (t *Task) End() {}

// Region mocks runtime/trace.Region.
type Region struct{}

// End mocks runtime/trace.Region.End.
func (r *Region) End() {}

// NewTask mocks runtime/trace.NewTask.
func NewTask(pctx context.Context, taskType string) (ctx context.Context, task *Task) {
	return pctx, &Task{}
}

// StartRegion mocks runtime/trace.StartRegion.
func StartRegion(ctx context.Context, regionType string) (region *Region) {
	return &Region{}
}

// WithRegion mocks runtime/trace.WithRegion.
func WithRegion(ctx context.Context, regionType string, fn func()) {
	fn()
}

// IsEnabled mocks runtime/trace.IsEnabled.
func IsEnabled() bool {
	return false
}

// Log mocks runtime/trace.Log.
func Log(ctx context.Context, category, message string) {
	return
}

// Logf mocks runtime/trace.Logf.
func Logf(ctx context.Context, category, message string, args ...interface{}) {
	return
}

// Start mocks runtime/trace.Start.
func Start(w io.Writer) (err error) {
	return
}

// Stop mocks runtime/trace.Stop.
func Stop() {
	return
}
