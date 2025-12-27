

// +build darwin dragonfly freebsd linux netbsd openbsd solaris
// +build !noloadavg

package metric

import (
	"fmt"

	"github.com/prometheus/client_golang/prometheus"

	"eqlite/src/utils/log"
)

type loadavgCollector struct {
	metric []typedDesc
}

// NewLoadavgCollector returns a new Collector exposing load average stats.
func NewLoadavgCollector() (Collector, error) {
	return &loadavgCollector{
		metric: []typedDesc{
			{prometheus.NewDesc(namespace+"_load1", "1m load average.", nil, nil), prometheus.GaugeValue},
			{prometheus.NewDesc(namespace+"_load5", "5m load average.", nil, nil), prometheus.GaugeValue},
			{prometheus.NewDesc(namespace+"_load15", "15m load average.", nil, nil), prometheus.GaugeValue},
		},
	}, nil
}

func (c *loadavgCollector) Update(ch chan<- prometheus.Metric) error {
	loads, err := getLoad()
	if err != nil {
		return fmt.Errorf("couldn't get load: %s", err)
	}
	for i, load := range loads {
		log.Debugf("return load %d: %f", i, load)
		ch <- c.metric[i].mustNewConstMetric(load)
	}
	return err
}
