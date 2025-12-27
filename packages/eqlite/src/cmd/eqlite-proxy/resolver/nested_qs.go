
package resolver

import (
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"regexp"
	"sort"
	"strconv"

	qs "github.com/derekstavis/go-qs"
	"github.com/gin-gonic/gin"
	"github.com/jmoiron/jsonq"
	"github.com/pkg/errors"
)

var numberRegex = regexp.MustCompile(`^\d+$`)

// CheckAndBindParams set binding object with parsed nested value if binding object is empty.
func CheckAndBindParams(c *gin.Context, res interface{}, pathes ...string) {
	if res == nil {
		return
	}

	rv := reflect.ValueOf(res)
	if rv.Kind() != reflect.Ptr {
		return
	}

	rve := rv.Elem()

	if !rve.CanSet() {
		return
	}

	switch rve.Kind() {
	case reflect.Slice, reflect.Map, reflect.Ptr, reflect.Interface, reflect.Chan, reflect.Func:
		if !rve.IsNil() {
			// already have value
			return

		}
	default:
		if rve.IsValid() && rve.Interface() != reflect.Zero(rve.Type()).Interface() {
			// already have value
			return
		}
	}

	contentType := c.ContentType()

	var values url.Values

	if c.Request.Method == http.MethodGet {
		values = c.Request.URL.Query()
	} else if contentType == gin.MIMEPOSTForm || contentType == gin.MIMEMultipartPOSTForm {
		values = c.Request.PostForm
	}

	rawRes, err := ParseNestedQuery(values, pathes...)
	if err != nil {
		return
	}

	rvRes := reflect.ValueOf(rawRes)

	if rve.Type() != rvRes.Type() {
		return
	}

	rve.Set(rvRes)
}

// ParseNestedQuery resolve nested object in specified path from url-encoded form.
func ParseNestedQuery(form url.Values, pathes ...string) (res interface{}, err error) {
	res, err = qs.Unmarshal(form.Encode())

	// normalize integer key fields to map
	if len(pathes) > 0 {
		res, err = jsonq.NewQuery(res).Interface(pathes...)
		if err != nil {
			err = errors.Wrapf(err, "parse query failed")
			return
		}
	}

	res = normalizeResult(res)
	return
}

func normalizeResult(d interface{}) (res interface{}) {
	switch dv := d.(type) {
	case []interface{}:
		var result []interface{}
		for _, v := range dv {
			result = append(result, normalizeResult(v))
		}
		res = result
	case map[string]interface{}:
		var keyNumbers []int

		for k := range dv {
			if !numberRegex.MatchString(k) {
				res = d
				break
			} else {
				intKey, _ := strconv.Atoi(k)
				keyNumbers = append(keyNumbers, intKey)
			}
		}

		sort.Ints(keyNumbers)
		last := len(keyNumbers) - 1

		if len(keyNumbers) > 0 && keyNumbers[0] == 0 && keyNumbers[last] == last {
			// consecutive numbers key, treated as array
			var result []interface{}

			for i := 0; i != last; i++ {
				result = append(result, dv[fmt.Sprint(i)])
			}

			res = result
		}
	default:
		res = d
	}

	return
}
