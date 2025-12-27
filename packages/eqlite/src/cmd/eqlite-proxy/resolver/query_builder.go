
package resolver

import (
	"fmt"

	"github.com/pkg/errors"
)

// Find process find query with filter/project/order by/limits like a mongodb.
func Find(table string, availFields FieldMap, query map[string]interface{}, projection map[string]interface{},
	orderBy map[string]interface{}, skip *int64, limit *int64) (
	statement string, args []interface{}, fields FieldMap, err error) {
	fields = FieldMap{}
	statement = `SELECT `

	// project segment
	projectionFields, projectionStatement, err := ResolveProjection(projection, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve query result projection failed")
		return
	}
	fields.Merge(projectionFields)
	statement += projectionStatement

	// table segment
	statement += fmt.Sprintf(` FROM "%s" `, table)

	// where segment
	filterFields, filterStatement, filterArgs, err := ResolveFilter(query, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve query filter failed")
		return
	}
	fields.Merge(filterFields)
	args = append(args, filterArgs...)

	if filterStatement != "" {
		statement += " WHERE "
		statement += filterStatement
	}

	// order by segment
	orderByFields, orderByStatement, err := ResolveOrderBy(orderBy, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve order by failed")
		return
	}
	fields.Merge(orderByFields)

	if orderByStatement != "" {
		statement += " ORDER BY "
		statement += orderByStatement
	}

	if skip != nil || limit != nil {
		if skip == nil {
			statement += fmt.Sprintf(" LIMIT %d", *limit)
		} else if limit == nil {
			statement += fmt.Sprintf(" LIMIT %d, -1", *skip)
		} else {
			statement += fmt.Sprintf(" LIMIT %d, %d", *skip, *limit)
		}
	}

	return
}

// Insert process insert query like a mongodb.
func Insert(table string, availFields FieldMap, data map[string]interface{}) (
	statement string, args []interface{}, fields FieldMap, err error) {
	fields, statement, args, err = ResolveInsert(data, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve query insert data failed")
		return
	}

	statement = `INSERT INTO "` + table + `" ` + statement
	return
}

// Update process update query with filter and update object like a mongodb.
func Update(table string, availFields FieldMap, filter map[string]interface{},
	update map[string]interface{}, justOne bool) (
	statement string, args []interface{}, fields FieldMap, err error) {
	fields = FieldMap{}

	statement = `UPDATE "` + table + `" `

	// update set segment
	updateFields, updateStatement, updateArgs, err := ResolveUpdate(update, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve query update data failed")
		return
	}
	fields.Merge(updateFields)
	statement += updateStatement
	args = append(args, updateArgs...)

	// update filter statement
	filterFields, filterStatement, filterArgs, err := ResolveFilter(filter, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve query filter failed")
		return
	}

	fields.Merge(filterFields)
	args = append(args, filterArgs...)

	if filterStatement != "" {
		statement += " WHERE "
		statement += filterStatement
	}

	if justOne {
		statement += " LIMIT 1"
	}

	return
}

// Remove process remove query with filter like a mongodb.
func Remove(table string, availFields FieldMap, filter map[string]interface{}, justOne bool) (
	statement string, args []interface{}, fields FieldMap, err error) {
	fields = FieldMap{}

	statement = `DELETE FROM "` + table + `" `

	// delete filter statement
	filterFields, filterStatement, filterArgs, err := ResolveFilter(filter, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve query filter failed")
		return
	}

	fields.Merge(filterFields)
	args = append(args, filterArgs...)

	if filterStatement != "" {
		statement += " WHERE "
		statement += filterStatement
	}

	if justOne {
		statement += " LIMIT 1"
	}

	return
}

// Count calculate record count in table applied with filter.
func Count(table string, availFields FieldMap, filter map[string]interface{}) (
	statement string, args []interface{}, fields FieldMap, err error) {
	fields = FieldMap{}
	statement = `SELECT COUNT(1) AS "cnt" FROM "` + table + `" `

	// count filter statement
	filterFields, filterStatement, filterArgs, err := ResolveFilter(filter, availFields)
	if err != nil {
		err = errors.Wrapf(err, "resolve query filter failed")
		return
	}

	fields.Merge(filterFields)
	args = append(args, filterArgs...)

	if filterStatement != "" {
		statement += " WHERE "
		statement += filterStatement
	}

	return
}
