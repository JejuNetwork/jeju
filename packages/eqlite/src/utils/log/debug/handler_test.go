
package debug_test

import (
	"encoding/json"
	"net"
	"net/http"
	"testing"

	"github.com/jmoiron/jsonq"
	. "github.com/smartystreets/goconvey/convey"

	"eqlite/src/utils/log"
)

func parseResponse(resp *http.Response, r error) (result *jsonq.JsonQuery, err error) {
	if r != nil {
		err = r
		return
	}

	var res map[string]interface{}
	err = json.NewDecoder(resp.Body).Decode(&res)
	if err != nil {
		return
	}

	result = jsonq.NewQuery(res)
	return
}

func mustJSONQ(c C) func(interface{}, error) interface{} {
	return func(i interface{}, e error) interface{} {
		c.So(e, ShouldBeNil)
		return i
	}
}

func TestDebugHandler(t *testing.T) {
	Convey("test debug handler", t, func(c C) {
		server := http.Server{}
		listener, err := net.Listen("tcp", ":0")
		So(err, ShouldBeNil)
		defer func() {
			_ = listener.Close()
		}()
		go func() {
			_ = server.Serve(listener)
		}()
		log.SetLevel(log.DebugLevel)
		url := "http://" + listener.Addr().String() + "/debug/eqlite/loglevel"
		resp, err := parseResponse(http.Get(url))
		So(err, ShouldBeNil)
		So(mustJSONQ(c)(resp.String("level")), ShouldEqual, log.GetLevel().String())
		resp, err = parseResponse(http.PostForm(url, map[string][]string{"level": {"fatal"}}))
		So(err, ShouldBeNil)
		So(mustJSONQ(c)(resp.String("level")), ShouldEqual, log.GetLevel().String())
		So(log.GetLevel().String(), ShouldEqual, "fatal")
		So(mustJSONQ(c)(resp.String("orig")), ShouldEqual, "debug")
		So(mustJSONQ(c)(resp.String("want")), ShouldEqual, "fatal")
		resp, err = parseResponse(http.PostForm(url, map[string][]string{"level": {"info"}}))
		So(err, ShouldBeNil)
		So(mustJSONQ(c)(resp.String("level")), ShouldEqual, log.GetLevel().String())
		So(log.GetLevel().String(), ShouldEqual, "info")
		So(mustJSONQ(c)(resp.String("orig")), ShouldEqual, "fatal")
		So(mustJSONQ(c)(resp.String("want")), ShouldEqual, "info")

		// test invalid level
		resp, err = parseResponse(http.PostForm(url, map[string][]string{"level": {"happy"}}))
		So(err, ShouldBeNil)
		So(mustJSONQ(c)(resp.String("level")), ShouldEqual, log.GetLevel().String())
		So(log.GetLevel().String(), ShouldEqual, "info")
		So(mustJSONQ(c)(resp.String("orig")), ShouldEqual, "info")
		So(mustJSONQ(c)(resp.String("want")), ShouldEqual, "happy")
		So(mustJSONQ(c)(resp.String("err")), ShouldNotBeEmpty)

		// test empty level
		resp, err = parseResponse(http.PostForm(url, nil))
		So(err, ShouldBeNil)
		So(mustJSONQ(c)(resp.String("level")), ShouldEqual, log.GetLevel().String())
		So(log.GetLevel().String(), ShouldEqual, "info")
		So(mustJSONQ(c)(resp.String("orig")), ShouldEqual, "info")

		// test invalid query
		rawResp, err := http.Head(url)
		So(err, ShouldBeNil)
		So(rawResp.StatusCode, ShouldEqual, http.StatusBadRequest)

	})
}
