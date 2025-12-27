
package metric

import (
	"sort"

	"github.com/prometheus/client_golang/prometheus"

	"eqlite/src/utils/log"
)

// Version info for EQLite - set at build time
var (
	Version   = "unknown"
	Revision  = "unknown"
	Branch    = "unknown"
	BuildDate = "unknown"
)

func init() {
	// Register version info as a gauge
	buildInfo := prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "eqlite",
			Name:      "build_info",
			Help:      "A metric with a constant '1' value labeled by version, revision, branch, and build_date.",
		},
		[]string{"version", "revision", "branch", "build_date"},
	)
	buildInfo.WithLabelValues(Version, Revision, Branch, BuildDate).Set(1)
	prometheus.MustRegister(buildInfo)
}

// StartMetricCollector starts collector registered in NewNodeCollector().
func StartMetricCollector() (registry *prometheus.Registry) {
	nc, err := NewNodeCollector()
	if err != nil {
		log.WithError(err).Error("couldn't create node collector")
		return
	}

	registry = prometheus.NewRegistry()
	err = registry.Register(nc)
	if err != nil {
		log.WithError(err).Error("couldn't register collector")
		return nil
	}

	log.Info("enabled collectors:")
	var collectors []string
	for n := range nc.Collectors {
		collectors = append(collectors, n)
	}
	sort.Strings(collectors)
	for _, n := range collectors {
		log.Infof(" - %s", n)
	}

	return
}
