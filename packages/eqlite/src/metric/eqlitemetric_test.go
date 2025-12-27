package metric

import (
	"flag"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/utils/log"
)

func TestMetrics(t *testing.T) {
	flag.Parse()
	log.SetLevel(log.DebugLevel)
	reg := prometheus.NewRegistry()
	reg.MustRegister(NewEQLiteCollector())
	log.Debug("gauge Collector 'EQLiteCollector' registered.")

	time.Sleep(1100 * time.Millisecond)
	Convey("get metric", t, func() {
		mfs, err := reg.Gather()
		if err != nil {
			t.Fatal(err)
		}
		for _, mf := range mfs {
			log.Debugf("mfs: %s", mf.String())
		}
	})
}
