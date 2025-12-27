
package utils

import (
	"os"
	"runtime"
	"runtime/pprof"

	"eqlite/src/utils/log"
)

var prof struct {
	cpu *os.File
	mem *os.File
}

// StartProfile initializes the CPU and memory profile, if specified.
func StartProfile(cpuprofile, memprofile string) error {
	if cpuprofile != "" {
		f, err := os.Create(cpuprofile)
		if err != nil {
			log.WithField("file", cpuprofile).WithError(err).Error("failed to create CPU profile file")
			return err
		}
		log.WithField("file", cpuprofile).Info("writing CPU profiling to file")
		prof.cpu = f
		pprof.StartCPUProfile(prof.cpu)
	}

	if memprofile != "" {
		f, err := os.Create(memprofile)
		if err != nil {
			log.WithField("file", memprofile).WithError(err).Error("failed to create memory profile file")
			return err
		}
		log.WithField("file", memprofile).WithError(err).Info("writing memory profiling to file")
		prof.mem = f
		runtime.MemProfileRate = 4096
	}
	return nil
}

// StopProfile closes the CPU and memory profiles if they are running.
func StopProfile() {
	if prof.cpu != nil {
		pprof.StopCPUProfile()
		prof.cpu.Close()
		log.Info("CPU profiling stopped")
	}
	if prof.mem != nil {
		pprof.WriteHeapProfile(prof.mem)
		prof.mem.Close()
		log.Info("memory profiling stopped")
	}
}
