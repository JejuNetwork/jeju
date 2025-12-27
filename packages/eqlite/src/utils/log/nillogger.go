
package log

import (
	"github.com/sirupsen/logrus"
)

// NilFormatter just discards the log entry.
type NilFormatter struct{}

// Format just return nil, nil for discarding log entry.
func (f *NilFormatter) Format(entry *logrus.Entry) ([]byte, error) {
	return nil, nil
}

// NilWriter just discards the log entry.
type NilWriter struct{}

// Write just return 0, nil for discarding log entry.
func (w *NilWriter) Write(p []byte) (n int, err error) {
	return 0, nil
}
