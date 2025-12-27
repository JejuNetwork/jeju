
package metric

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

const historyCount = 2

const updateInterval = 5 * time.Minute

// eqliteStatsMetrics provide description, value, and value type for EQLite stat metrics.
type eqliteStatsMetrics []struct {
	desc    *prometheus.Desc
	eval    func(*EQLiteCollector) float64
	valType prometheus.ValueType
}

// EQLiteCollector collects EQLite metrics.
type EQLiteCollector struct {
	eqliteStatHistory [historyCount]int64
	sync.RWMutex

	// metrics to describe and collect
	metrics eqliteStatsMetrics

	// context for graceful shutdown
	ctx    context.Context
	cancel context.CancelFunc
}

func eqliteStatNamespace(s string) string {
	return fmt.Sprintf("eqlitestats_%s", s)
}

// NewEQLiteCollector returns a new EQLiteCollector.
func NewEQLiteCollector() prometheus.Collector {
	ctx, cancel := context.WithCancel(context.Background())
	cc := &EQLiteCollector{
		eqliteStatHistory: [historyCount]int64{},
		RWMutex:                sync.RWMutex{},
		ctx:                    ctx,
		cancel:                 cancel,
		metrics: eqliteStatsMetrics{
			{
				desc: prometheus.NewDesc(
					eqliteStatNamespace("db_random"),
					"EQLite random",
					nil,
					nil,
				),
				eval:    EQLiteIdle,
				valType: prometheus.GaugeValue,
			},
		},
	}

	go cc.runUpdateLoop()
	return cc
}

func (cc *EQLiteCollector) runUpdateLoop() {
	ticker := time.NewTicker(updateInterval)
	defer ticker.Stop()

	for {
		select {
		case <-cc.ctx.Done():
			return
		case <-ticker.C:
			cc.updateEQLiteStat()
		}
	}
}

// Describe returns all descriptions of the collector.
func (cc *EQLiteCollector) Describe(ch chan<- *prometheus.Desc) {
	for _, i := range cc.metrics {
		ch <- i.desc
	}
}

// Collect returns the current state of all metrics of the collector.
func (cc *EQLiteCollector) Collect(ch chan<- prometheus.Metric) {
	if !cc.EQLitePrepared() {
		return
	}

	for _, i := range cc.metrics {
		ch <- prometheus.MustNewConstMetric(i.desc, i.valType, i.eval(cc))
	}
}

// updateEQLiteStat updates metric in background.
func (cc *EQLiteCollector) updateEQLiteStat() error {
	cc.Lock()
	defer cc.Unlock()
	for i := historyCount - 1; i > 0; i-- {
		cc.eqliteStatHistory[i] = cc.eqliteStatHistory[i-1]
	}

	cc.eqliteStatHistory[0] = time.Now().UnixNano()
	return nil
}

// EQLiteIdle gets the idle of DB.
func EQLiteIdle(cc *EQLiteCollector) float64 {
	cc.RLock()
	defer cc.RUnlock()
	//TODO(auxten): implement EQLite Idle metric
	return float64(cc.eqliteStatHistory[0] - cc.eqliteStatHistory[1])
}

// EQLitePrepared returns true when the metric is ready to be collected.
func (cc *EQLiteCollector) EQLitePrepared() bool {
	cc.RLock()
	defer cc.RUnlock()
	return cc.eqliteStatHistory[1] != 0
}

// Stop gracefully stops the collector's update loop.
func (cc *EQLiteCollector) Stop() {
	if cc.cancel != nil {
		cc.cancel()
	}
}
