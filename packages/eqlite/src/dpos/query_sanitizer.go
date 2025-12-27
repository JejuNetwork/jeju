package dpos

import (
	"database/sql"
	"strings"

	"github.com/pkg/errors"
	"github.com/xwb1989/sqlparser"

	"eqlite/src/types"
	"eqlite/src/utils/log"
)

var (
	sanitizeFunctionMap = map[string]map[string]bool{
		"load_extension": nil,
		"unlikely":       nil,
		"likelihood":     nil,
		"likely":         nil,
		"affinity":       nil,
		"typeof":         nil,
		"random":         nil,
		"randomblob":     nil,
		"unknown":        nil,
		"date": {
			"now":       true,
			"localtime": true,
		},
		"time": {
			"now":       true,
			"localtime": true,
		},
		"datetime": {
			"now":       true,
			"localtime": true,
		},
		"julianday": {
			"now":       true,
			"localtime": true,
		},
		"strftime": {
			"now":       true,
			"localtime": true,
		},
	}
)

func convertQueryAndBuildArgs(pattern string, args []types.NamedArg) (containsDDL bool, p string, ifs []interface{}, err error) {
	if lower := strings.ToLower(pattern); strings.Contains(lower, "begin") ||
		strings.Contains(lower, "rollback") || strings.Contains(lower, "commit") {
		return false, pattern, nil, nil
	}

	// Split by semicolon for multiple statements
	queries := strings.Split(pattern, ";")
	var resultQueries []string

	for _, query := range queries {
		query = strings.TrimSpace(query)
		if query == "" {
			continue
		}

		// Try to parse the statement
		stmt, parseErr := sqlparser.Parse(query)
		if parseErr != nil {
			// If parsing fails, just pass through the query
			log.WithError(parseErr).WithField("query", query).Debug("failed to parse query, passing through")
			resultQueries = append(resultQueries, query)
			continue
		}

		switch s := stmt.(type) {
		case *sqlparser.Show:
			// Handle SHOW statements - convert to SQLite equivalents
			translated := translateShowStatement(s)
			if translated != "" {
				log.WithFields(log.Fields{
					"from": query,
					"to":   translated,
				}).Debug("query translated")
				resultQueries = append(resultQueries, translated)
			} else {
				resultQueries = append(resultQueries, query)
			}
		case *sqlparser.DDL:
			containsDDL = true
			// Check for invalid table names
			if s.NewName.Name.String() != "" && strings.HasPrefix(strings.ToLower(s.NewName.Name.String()), "sqlite") {
				err = errors.Wrapf(ErrInvalidTableName, "%s", s.NewName.Name.String())
				return
			}
			if s.Table.Name.String() != "" && strings.HasPrefix(strings.ToLower(s.Table.Name.String()), "sqlite") {
				err = errors.Wrapf(ErrInvalidTableName, "%s", s.Table.Name.String())
				return
			}
			resultQueries = append(resultQueries, query)
		default:
			// Check for stateful functions
			if err = checkStatefulFunctions(query); err != nil {
				return
			}
			resultQueries = append(resultQueries, query)
		}
	}

	p = strings.Join(resultQueries, "; ")

	ifs = make([]interface{}, len(args))
	for i, v := range args {
		ifs[i] = sql.NamedArg{
			Name:  v.Name,
			Value: v.Value,
		}
	}
	return
}

// translateShowStatement translates MySQL-style SHOW statements to SQLite equivalents
func translateShowStatement(stmt *sqlparser.Show) string {
	switch strings.ToLower(stmt.Type) {
	case "tables":
		return `SELECT name FROM sqlite_master WHERE type = "table" AND name NOT LIKE "sqlite%"`
	case "table":
		if stmt.OnTable.Name.String() != "" {
			return "PRAGMA table_info(" + stmt.OnTable.Name.String() + ")"
		}
	case "index":
		if stmt.OnTable.Name.String() != "" {
			return `SELECT name FROM sqlite_master WHERE type = "index" AND tbl_name = "` + stmt.OnTable.Name.String() + `" AND name NOT LIKE "sqlite%"`
		}
	}
	return ""
}

// checkStatefulFunctions checks for disallowed stateful functions in a query
func checkStatefulFunctions(query string) error {
	lower := strings.ToLower(query)

	// Check for random functions
	if strings.Contains(lower, "random(") || strings.Contains(lower, "randomblob(") {
		return errors.Wrap(ErrStatefulQueryParts, "random function not supported")
	}

	// Check for current_timestamp
	if strings.Contains(lower, "current_timestamp") {
		return errors.Wrap(ErrStatefulQueryParts, "CURRENT_TIMESTAMP not supported")
	}

	// Check for sqlite functions
	if strings.Contains(lower, "sqlite_") {
		return errors.Wrap(ErrStatefulQueryParts, "sqlite internal functions not supported")
	}

	// Check for date/time functions with 'now'
	for funcName, args := range sanitizeFunctionMap {
		if args != nil && strings.Contains(lower, funcName+"(") {
			for arg := range args {
				if strings.Contains(lower, "'"+arg+"'") {
					return errors.Wrapf(ErrStatefulQueryParts, "stateful function %s with %s not supported", funcName, arg)
				}
			}
		}
	}

	return nil
}
