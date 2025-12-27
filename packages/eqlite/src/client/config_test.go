
package client

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestConfig(t *testing.T) {
	Convey("test config without additional options", t, func() {
		cfg, err := ParseDSN("eqlite://db")
		So(err, ShouldBeNil)
		So(cfg, ShouldResemble, &Config{
			DatabaseID:  "db",
			UseLeader:   true,
			UseFollower: false,
		})

		recoveredCfg, err := ParseDSN(cfg.FormatDSN())
		So(err, ShouldBeNil)
		So(cfg, ShouldResemble, recoveredCfg)
	})

	Convey("test invalid config", t, func() {
		cfg, err := ParseDSN("invalid dsn")
		So(err, ShouldNotBeNil)
		So(cfg, ShouldBeNil)
	})

	Convey("test dsn with only database id", t, func() {
		dbIDStr := "00000bef611d346c0cbe1beaa76e7f0ed705a194fdf9ac3a248ec70e9c198bf9"
		cfg, err := ParseDSN(dbIDStr)
		So(err, ShouldBeNil)
		So(cfg, ShouldResemble, &Config{
			DatabaseID:  dbIDStr,
			UseLeader:   true,
			UseFollower: false,
		})

		recoveredCfg, err := ParseDSN(cfg.FormatDSN())
		So(err, ShouldBeNil)
		So(cfg, ShouldResemble, recoveredCfg)
	})

	Convey("test dsn with additional options", t, func() {
		cfg, err := ParseDSN("eqlite://db?use_leader=0&use_follower=true")
		So(err, ShouldBeNil)
		So(cfg, ShouldResemble, &Config{
			DatabaseID:  "db",
			UseLeader:   false,
			UseFollower: true,
		})

		recoveredCfg, err := ParseDSN(cfg.FormatDSN())
		So(err, ShouldBeNil)
		So(cfg, ShouldResemble, recoveredCfg)
	})

	Convey("test dsn with use all kinds of options", t, func(c C) {
		testFormatAndParse := func(cfg *Config) {
			newCfg, err := ParseDSN(cfg.FormatDSN())
			c.So(err, ShouldBeNil)
			c.So(newCfg, ShouldResemble, cfg)
		}
		testFormatAndParse(&Config{
			UseLeader:   true,
			UseFollower: false,
		})
		testFormatAndParse(&Config{
			UseLeader:   false,
			UseFollower: true,
		})
		testFormatAndParse(&Config{
			UseLeader:   true,
			UseFollower: true,
		})
	})

	Convey("test format and parse dsn with mirror option", t, func() {
		cfg, err := ParseDSN("eqlite://db?mirror=happy")
		So(err, ShouldBeNil)
		So(cfg.Mirror, ShouldEqual, "happy")
		So(cfg.FormatDSN(), ShouldEqual, "eqlite://db?mirror=happy")
		cfg.Mirror = ""
		So(cfg.FormatDSN(), ShouldEqual, "eqlite://db")
	})
}
