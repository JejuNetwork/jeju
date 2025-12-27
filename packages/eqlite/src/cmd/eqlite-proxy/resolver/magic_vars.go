
package resolver

import "strings"

// InjectMagicVars replaces the variables symbol in query to real value.
func InjectMagicVars(q map[string]interface{}, vars map[string]interface{}) (
	injectedQuery map[string]interface{}) {
	if q == nil {
		return
	}

	injectedQuery = make(map[string]interface{}, len(q))

	for k, v := range q {
		injectedQuery[k] = processInject(v, vars)
	}

	return
}

func processInject(v interface{}, vars map[string]interface{}) (r interface{}) {
	switch rv := v.(type) {
	case []interface{}:
		var subQueryList []interface{}

		for _, ov := range rv {
			subQueryList = append(subQueryList, processInject(ov, vars))
		}

		r = subQueryList
	case map[string]interface{}:
		return InjectMagicVars(rv, vars)
	case string:
		if !strings.HasPrefix("$", rv) {
			r = v
		} else if injectedVar, ok := vars[rv[1:]]; !ok {
			r = v
		} else {
			r = injectedVar
		}
	default:
		// let it be
		r = v
	}

	return
}
