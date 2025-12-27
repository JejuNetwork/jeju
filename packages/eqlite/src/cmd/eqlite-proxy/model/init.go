
package model

import gorp "gopkg.in/gorp.v2"

// AddTables register tables to gorp database map.
func AddTables(dbMap *gorp.DbMap) {
	dbMap.AddTableWithName(Developer{}, "developer").
		SetKeys(true, "ID").
		ColMap("GithubID").SetUnique(true)
	dbMap.AddTableWithName(Session{}, "session").
		SetKeys(false, "ID")
	dbMap.AddTableWithName(TokenApply{}, "token_apply").
		SetKeys(false, "ID")
	dbMap.AddTableWithName(DeveloperPrivateKey{}, "private_keys").
		SetKeys(true, "ID")
	dbMap.AddTableWithName(Task{}, "task").
		SetKeys(true, "ID")
	tblProject := dbMap.AddTableWithName(Project{}, "project").
		SetKeys(true, "ID")
	tblProject.ColMap("Alias").SetUnique(true)
	tblProject.ColMap("DB").SetUnique(true)
}
