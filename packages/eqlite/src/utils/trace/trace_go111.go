// +build go1.11


package trace

import (
	"context"
	"io"
	"runtime/trace"
)

// Task wraps runtime.trace.Task.
type Task = trace.Task

// Region wraps runtime/trace.Task.
type Region = trace.Region

// NewTask wraps runtime/trace.NewTask.
func NewTask(pctx context.Context, taskType string) (ctx context.Context, task *Task) {
	return trace.NewTask(pctx, taskType)
}

// StartRegion wraps runtime/trace.StartRegion.
func StartRegion(ctx context.Context, regionType string) (region *Region) {
	return trace.StartRegion(ctx, regionType)
}

// WithRegion wraps runtime/trace.WithRegion.
func WithRegion(ctx context.Context, regionType string, fn func()) {
	trace.WithRegion(ctx, regionType, fn)
}

// IsEnabled wraps runtime/trace.IsEnabled.
func IsEnabled() bool {
	return trace.IsEnabled()
}

// Log wraps runtime/trace.Log.
func Log(ctx context.Context, category, message string) {
	trace.Log(ctx, category, message)
}

// Logf wraps runtime/trace.Logf.
func Logf(ctx context.Context, category, message string, args ...interface{}) {
	trace.Logf(ctx, category, message, args...)
}

// Start wraps runtime/trace.Start.
func Start(w io.Writer) (err error) {
	return trace.Start(w)
}

// Stop wraps runtime/trace.Stop.
func Stop() {
	trace.Stop()
}
