
package main

import (
	"expvar"
	"io"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	mw "github.com/zserge/metric"

	"eqlite/src/conf"
	"eqlite/src/utils/log"
)

var (
	diskUsageMetric = mw.NewGauge("5m1m")
)

func collectDiskUsage() (err error) {
	// run du on linux and mac
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return
	}

	if conf.GConf == nil || conf.GConf.Miner == nil || conf.GConf.Miner.RootDir == "" {
		log.Error("miner config is empty, disk usage report is disabled")
		return
	}

	duBin, err := exec.LookPath("du")
	if err != nil {
		log.WithError(err).Error("could not found du command")
		return
	}

	cmd := exec.Command(duBin, "-sk", conf.GConf.Miner.RootDir)
	duOutput, err := cmd.StdoutPipe()
	if err != nil {
		log.WithError(err).Error("could not get result of disk usage")
		return
	}

	err = cmd.Start()
	if err != nil {
		log.WithError(err).Error("could not start disk usage command")
		return
	}

	duResult, err := io.ReadAll(duOutput)
	if err != nil {
		log.WithError(err).Error("get disk usage result failed")
		return
	}

	err = cmd.Wait()
	if err != nil {
		log.WithError(err).Error("run disk usage command failed")
		return
	}

	splitResult := strings.SplitN(string(duResult), "\t", 2)
	if len(splitResult) == 0 || len(strings.TrimSpace(splitResult[0])) == 0 {
		log.Error("could not get disk usage result")
		return
	}

	usedKiloBytes, err := strconv.ParseInt(strings.TrimSpace(splitResult[0]), 10, 64)
	if err != nil {
		log.WithError(err).Error("could not parse usage bytes result")
		return
	}

	diskUsageMetric.Add(float64(usedKiloBytes))

	return
}

func init() {
	expvar.Publish("service:miner:disk:usage", diskUsageMetric)
}
