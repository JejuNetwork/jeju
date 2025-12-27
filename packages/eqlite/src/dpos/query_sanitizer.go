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

		lower := strings.ToLower(query)

		// First try string-based SHOW handling (covers cases sqlparser can't handle)
		if strings.HasPrefix(lower, "show ") {
			translated := translateShowByString(query)
			if translated != "" {
				log.WithFields(log.Fields{
					"from": query,
					"to":   translated,
				}).Debug("query translated")
				resultQueries = append(resultQueries, translated)
				continue
			}
		}

		// Handle DESC/DESCRIBE statements
		if strings.HasPrefix(lower, "desc ") || strings.HasPrefix(lower, "describe ") {
			tableName := extractTableNameFromDesc(query)
			if tableName != "" {
				translated := "PRAGMA table_info(" + tableName + ")"
				log.WithFields(log.Fields{
					"from": query,
					"to":   translated,
				}).Debug("query translated")
				resultQueries = append(resultQueries, translated)
				continue
			}
		}

		// Check for DDL statements by string pattern (for cases parser doesn't handle)
		if isDDLByString(lower) {
			containsDDL = true
			// Check for invalid table names
			if strings.Contains(lower, "sqlite") {
				for _, word := range strings.Fields(lower) {
					if strings.HasPrefix(word, "sqlite") {
						err = errors.Wrapf(ErrInvalidTableName, "%s", word)
						return
					}
				}
			}
			// Check for stateful functions in DDL (e.g., DEFAULT CURRENT_TIMESTAMP)
			if err = checkStatefulFunctions(query); err != nil {
				return
			}
			resultQueries = append(resultQueries, query)
			continue
		}

		// Try to parse the statement
		stmt, parseErr := sqlparser.Parse(query)
		if parseErr != nil {
			// If it looks like DDL but fails to parse, return error
			if looksLikeDDL(lower) {
				err = errors.Wrap(parseErr, "parse sql failed")
				return
			}
			// Otherwise pass through the query
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

// translateShowByString handles SHOW statements by string pattern matching
// This handles cases that the SQL parser can't parse correctly
func translateShowByString(query string) string {
	lower := strings.ToLower(query)
	words := strings.Fields(lower)
	if len(words) < 2 {
		return ""
	}

	switch words[1] {
	case "tables":
		return `SELECT name FROM sqlite_master WHERE type = "table" AND name NOT LIKE "sqlite%"`
	case "index":
		// SHOW INDEX FROM [TABLE] tablename
		tableName := extractTableName(words, 2)
		if tableName != "" {
			return `SELECT name FROM sqlite_master WHERE type = "index" AND tbl_name = "` + tableName + `" AND name NOT LIKE "sqlite%"`
		}
	case "create":
		// SHOW CREATE TABLE tablename
		if len(words) >= 4 && words[2] == "table" {
			tableName := extractTableName(words, 3)
			if tableName != "" {
				return `SELECT sql FROM sqlite_master WHERE type = "table" AND tbl_name = "` + tableName + `" AND tbl_name NOT LIKE "sqlite%"`
			}
		}
	}
	return ""
}

// extractTableName extracts the table name from word list starting at index
func extractTableName(words []string, startIdx int) string {
	if startIdx >= len(words) {
		return ""
	}
	// Skip "from" or "table" keywords
	for i := startIdx; i < len(words); i++ {
		if words[i] != "from" && words[i] != "table" {
			return words[i]
		}
	}
	return ""
}

// extractTableNameFromDesc extracts table name from DESC/DESCRIBE statement
func extractTableNameFromDesc(query string) string {
	words := strings.Fields(query)
	if len(words) >= 2 {
		// DESC tablename or DESCRIBE tablename
		return words[1]
	}
	return ""
}

// isDDLByString checks if a query is a DDL statement by string pattern
func isDDLByString(lower string) bool {
	ddlPrefixes := []string{
		"create table",
		"create virtual table",
		"create index",
		"create unique index",
		"create trigger",
		"create view",
		"drop table",
		"drop index",
		"drop trigger",
		"drop view",
		"alter table",
	}
	for _, prefix := range ddlPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

// looksLikeDDL checks if a query looks like it's trying to be DDL
func looksLikeDDL(lower string) bool {
	// Check if it starts with a DDL keyword
	ddlKeywords := []string{"create ", "drop ", "alter "}
	for _, keyword := range ddlKeywords {
		if strings.HasPrefix(lower, keyword) {
			return true
		}
	}
	return false
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

	// Check for current_timestamp, current_date, current_time
	if strings.Contains(lower, "current_timestamp") {
		return errors.Wrap(ErrStatefulQueryParts, "CURRENT_TIMESTAMP not supported")
	}
	if strings.Contains(lower, "current_date") {
		return errors.Wrap(ErrStatefulQueryParts, "CURRENT_DATE not supported")
	}
	if strings.Contains(lower, "current_time") {
		return errors.Wrap(ErrStatefulQueryParts, "CURRENT_TIME not supported")
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
