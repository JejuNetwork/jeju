
package types

import (
	"testing"

	. "github.com/smartystreets/goconvey/convey"
)

func TestTokenType(t *testing.T) {
	Convey("test token util function", t, func() {
		eos := "EOS"
		unknown := "Unknown"
		token := FromString(eos)
		So(eos, ShouldEqual, token.String())
		So(token.Listed(), ShouldBeTrue)

		token = FromString("shitcoin")
		So(token.String(), ShouldEqual, unknown)
		So(token.Listed(), ShouldBeFalse)

		token = SupportTokenNumber
		So(token.String(), ShouldEqual, unknown)
		So(token.Listed(), ShouldBeFalse)
	})

	Convey("test token list", t, func() {
		So(SupportTokenNumber, ShouldEqual, len(TokenList))

		var i TokenType
		token := make(map[string]int)
		for i = 0; i < SupportTokenNumber; i++ {
			t, ok := TokenList[i]
			So(ok, ShouldBeTrue)
			token[t] = 1
		}
		So(len(token), ShouldEqual, SupportTokenNumber)
	})
}
