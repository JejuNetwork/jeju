package metric

import (
	"expvar"
	"net/http"
	"runtime"
	"time"

	"github.com/pkg/errors"
	mw "github.com/zserge/metric"

	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

func collect(cc *CollectClient) (err error) {
	mfs, err := cc.Registry.Gather()
	if err != nil {
		err = errors.Wrap(err, "gathering node metrics failed")
		return
	}
	mm := make(SimpleMetricMap, 0)
	for _, mf := range mfs {
		mm[*mf.Name] = mf
		log.Debugf("gathered node: %v", mf)
	}
	crucialMetrics := mm.FilterCrucialMetrics()
	for k, v := range crucialMetrics {
		var val expvar.Var
		if val = expvar.Get(k); val == nil {
			expvar.Publish(k, mw.NewGauge("1h1m"))
			val = expvar.Get(k)
		}
		val.(mw.Metric).Add(v)
	}

	return
}

// InitMetricWeb initializes the /debug/metrics web.
func InitMetricWeb(metricWeb string) (err error) {
	// Some Go internal metrics
	expvar.Publish("go:numgoroutine", mw.NewGauge("1m1s", "5m5s", "1h1m"))
	expvar.Publish("go:numcgocall", mw.NewGauge("1m1s", "5m5s", "1h1m"))
	expvar.Publish("go:alloc", mw.NewGauge("1m1s", "5m5s", "1h1m"))
	expvar.Publish("go:alloctotal", mw.NewGauge("1m1s", "5m5s", "1h1m"))

	// start period provide service transaction generator
	// start prometheus collector
	cc := NewCollectClient()
	err = collect(cc)
	if err != nil {
		return
	}

	go func() {
		for range time.Tick(time.Minute) {
			_ = collect(cc)
		}
	}()

	go func() {
		for range time.Tick(5 * time.Second) {
			m := &runtime.MemStats{}
			runtime.ReadMemStats(m)
			expvar.Get("go:numgoroutine").(mw.Metric).Add(float64(runtime.NumGoroutine()))
			expvar.Get("go:numcgocall").(mw.Metric).Add(float64(runtime.NumCgoCall()))
			expvar.Get("go:alloc").(mw.Metric).Add(float64(m.Alloc) / float64(utils.MB))
			expvar.Get("go:alloctotal").(mw.Metric).Add(float64(m.TotalAlloc) / float64(utils.MB))
		}
	}()
	http.Handle("/debug/metrics", mw.Handler(mw.Exposed))
	go func() {
		_ = http.ListenAndServe(metricWeb, nil)
	}()
	return
}
