
package sqlchain

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestBlockCacheTTL(t *testing.T) {
	Convey("Test block cache TTL setting", t, func() {
		var cases = []struct {
			config *Config
			expect int32
		}{
			{
				config: &Config{
					BlockCacheTTL: -1,
					UpdatePeriod:  0,
				},
				expect: 0,
			},
			{
				config: &Config{
					BlockCacheTTL: 100,
					UpdatePeriod:  0,
				},
				expect: 100,
			},
			{
				config: &Config{
					BlockCacheTTL: 0,
					UpdatePeriod:  100,
				},
				expect: 0,
			},
		}
		for _, v := range cases {
			So(blockCacheTTLRequired(v.config), ShouldEqual, v.expect)
		}
	})
}
