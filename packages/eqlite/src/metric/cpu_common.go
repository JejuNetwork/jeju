// +build !nocpu

package metric

import (
	"github.com/prometheus/client_golang/prometheus"
)

const (
	cpuCollectorSubsystem = "cpu"
)

var (
	nodeCPUSecondsDesc = prometheus.NewDesc(
		prometheus.BuildFQName(namespace, cpuCollectorSubsystem, "seconds_total"),
		"Seconds the cpus spent in each mode.",
		[]string{"cpu", "mode"}, nil,
	)
	nodeCPUCountDesc = prometheus.NewDesc(
		prometheus.BuildFQName(namespace, cpuCollectorSubsystem, "count"),
		"CPU count",
		nil, nil,
	)
)
