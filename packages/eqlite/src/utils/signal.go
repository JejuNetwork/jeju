
package utils

import (
	"os"
	"os/signal"
	"syscall"
)

// WaitForExit waits for user cancellation signals: SIGINT/SIGTERM and ignore SIGHUP/SIGTTIN/SIGTTOU.
func WaitForExit() <-chan os.Signal {
	signalCh := make(chan os.Signal, 1)
	signal.Notify(
		signalCh,
		syscall.SIGINT,
		syscall.SIGTERM,
	)
	signal.Ignore(syscall.SIGHUP, syscall.SIGTTIN, syscall.SIGTTOU)
	return signalCh
}
