
package blockproducer

import (
	"bytes"
	"sort"

	"github.com/mohae/deepcopy"
	"github.com/pkg/errors"

	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/crypto"
	"eqlite/src/proto"
	"eqlite/src/types"
	"eqlite/src/utils"
	"eqlite/src/utils/log"
)

var (
	sqlchainPeriod uint64 = 60 * 24 * 30
)

// TODO(leventeliu): lock optimization.

type metaState struct {
	dirty, readonly *metaIndex
}

// MinerInfos is MinerInfo array.
type MinerInfos []*types.MinerInfo

// Len returns the length of the uints array.
func (x MinerInfos) Len() int { return len(x) }

// Less returns true if MinerInfo i is less than node j.
func (x MinerInfos) Less(i, j int) bool {
	return x[i].NodeID < x[j].NodeID
}

// Swap exchanges MinerInfo i and j.
func (x MinerInfos) Swap(i, j int) { x[i], x[j] = x[j], x[i] }

func newMetaState() *metaState {
	return &metaState{
		dirty:    newMetaIndex(),
		readonly: newMetaIndex(),
	}
}

func (s *metaState) loadAccountObject(k proto.AccountAddress) (o *types.Account, loaded bool) {
	var old *types.Account
	if old, loaded = s.dirty.accounts[k]; loaded {
		if old == nil {
			loaded = false
			return
		}
		o = deepcopy.Copy(old).(*types.Account)
		return
	}
	if old, loaded = s.readonly.accounts[k]; loaded {
		o = deepcopy.Copy(old).(*types.Account)
		return
	}
	return
}

func (s *metaState) loadOrStoreAccountObject(
	k proto.AccountAddress, v *types.Account) (o *types.Account, loaded bool,
) {
	if o, loaded = s.dirty.accounts[k]; loaded && o != nil {
		return
	}
	if o, loaded = s.readonly.accounts[k]; loaded {
		return
	}
	s.dirty.accounts[k] = v
	return
}

func (s *metaState) storeBaseAccount(k proto.AccountAddress, v *types.Account) (err error) {
	log.WithFields(log.Fields{
		"addr":    k,
		"account": v,
	}).Debug("store account")
	if ao, ok := s.loadOrStoreAccountObject(k, v); ok {
		if ao.NextNonce != 0 {
			err = ErrAccountExists
			return
		}
	}
	return
}

func (s *metaState) loadSQLChainObject(k proto.DatabaseID) (o *types.SQLChainProfile, loaded bool) {
	var old *types.SQLChainProfile
	if old, loaded = s.dirty.databases[k]; loaded {
		if old == nil {
			loaded = false
			return
		}
		o = deepcopy.Copy(old).(*types.SQLChainProfile)
		return
	}
	if old, loaded = s.readonly.databases[k]; loaded {
		o = deepcopy.Copy(old).(*types.SQLChainProfile)
		return
	}
	return
}

func (s *metaState) loadOrStoreSQLChainObject(
	k proto.DatabaseID, v *types.SQLChainProfile) (o *types.SQLChainProfile, loaded bool,
) {
	if o, loaded = s.dirty.databases[k]; loaded && o != nil {
		return
	}
	if o, loaded = s.readonly.databases[k]; loaded {
		return
	}
	s.dirty.databases[k] = v
	return
}

func (s *metaState) loadProviderObject(k proto.AccountAddress) (o *types.ProviderProfile, loaded bool) {
	if o, loaded = s.dirty.provider[k]; loaded {
		if o == nil {
			loaded = false
		}
		return
	}
	if o, loaded = s.readonly.provider[k]; loaded {
		return
	}
	return
}

func (s *metaState) loadOrStoreProviderObject(k proto.AccountAddress, v *types.ProviderProfile) (o *types.ProviderProfile, loaded bool) {
	if o, loaded = s.dirty.provider[k]; loaded && o != nil {
		return
	}
	if o, loaded = s.readonly.provider[k]; loaded {
		return
	}
	s.dirty.provider[k] = v
	return
}

func (s *metaState) deleteAccountObject(k proto.AccountAddress) {
	// Use a nil pointer to mark a deletion, which will be later used by commit procedure.
	s.dirty.accounts[k] = nil
}

func (s *metaState) deleteSQLChainObject(k proto.DatabaseID) {
	// Use a nil pointer to mark a deletion, which will be later used by commit procedure.
	s.dirty.databases[k] = nil
}

func (s *metaState) deleteProviderObject(k proto.AccountAddress) {
	// Use a nil pointer to mark a deletion, which will be later used by commit procedure.
	s.dirty.provider[k] = nil
}

func (s *metaState) commit() {
	for k, v := range s.dirty.accounts {
		if v != nil {
			// New/update object
			s.readonly.accounts[k] = v
		} else {
			// Delete object
			delete(s.readonly.accounts, k)
		}
	}
	for k, v := range s.dirty.databases {
		if v != nil {
			// New/update object
			s.readonly.databases[k] = v
		} else {
			// Delete object
			delete(s.readonly.databases, k)
		}
	}
	for k, v := range s.dirty.provider {
		if v != nil {
			// New/update object
			s.readonly.provider[k] = v
		} else {
			// Delete object
			delete(s.readonly.provider, k)
		}
	}
	// Clean dirty map
	s.dirty = newMetaIndex()
}

func (s *metaState) clean() {
	s.dirty = newMetaIndex()
}

func (s *metaState) createSQLChain(addr proto.AccountAddress, id proto.DatabaseID) error {
	if _, ok := s.dirty.accounts[addr]; !ok {
		if _, ok := s.readonly.accounts[addr]; !ok {
			return ErrAccountNotFound
		}
	}
	if _, ok := s.dirty.databases[id]; ok {
		return ErrDatabaseExists
	} else if _, ok := s.readonly.databases[id]; ok {
		return ErrDatabaseExists
	}
	s.dirty.databases[id] = &types.SQLChainProfile{
		ID:     id,
		Owner:  addr,
		Miners: make(MinerInfos, 0),
		Users: []*types.SQLChainUser{
			{
				Address:    addr,
				Permission: types.UserPermissionFromRole(types.Admin),
			},
		},
	}
	return nil
}

func (s *metaState) addSQLChainUser(
	k proto.DatabaseID, addr proto.AccountAddress, perm *types.UserPermission) (_ error,
) {
	var (
		src, dst *types.SQLChainProfile
		ok       bool
	)
	if dst, ok = s.dirty.databases[k]; !ok {
		if src, ok = s.readonly.databases[k]; !ok {
			return ErrDatabaseNotFound
		}
		dst = deepcopy.Copy(src).(*types.SQLChainProfile)
		s.dirty.databases[k] = dst
	}
	for _, v := range dst.Users {
		if v.Address == addr {
			return ErrDatabaseUserExists
		}
	}
	dst.Users = append(dst.Users, &types.SQLChainUser{
		Address:    addr,
		Permission: perm,
	})
	return
}

func (s *metaState) deleteSQLChainUser(k proto.DatabaseID, addr proto.AccountAddress) error {
	var (
		src, dst *types.SQLChainProfile
		ok       bool
	)
	if dst, ok = s.dirty.databases[k]; !ok {
		if src, ok = s.readonly.databases[k]; !ok {
			return ErrDatabaseNotFound
		}
		dst = deepcopy.Copy(src).(*types.SQLChainProfile)
		s.dirty.databases[k] = dst
	}
	for i, v := range dst.Users {
		if v.Address == addr {
			last := len(dst.Users) - 1
			dst.Users[i] = dst.Users[last]
			dst.Users[last] = nil
			dst.Users = dst.Users[:last]
		}
	}
	return nil
}

func (s *metaState) alterSQLChainUser(
	k proto.DatabaseID, addr proto.AccountAddress, perm *types.UserPermission) (_ error) {
	var (
		src, dst *types.SQLChainProfile
		ok       bool
	)
	if dst, ok = s.dirty.databases[k]; !ok {
		if src, ok = s.readonly.databases[k]; !ok {
			return ErrDatabaseNotFound
		}
		dst = deepcopy.Copy(src).(*types.SQLChainProfile)
		s.dirty.databases[k] = dst
	}
	for _, v := range dst.Users {
		if v.Address == addr {
			v.Permission = perm
		}
	}
	return
}

func (s *metaState) nextNonce(addr proto.AccountAddress) (nonce pi.AccountNonce, err error) {
	var (
		o      *types.Account
		loaded bool
	)
	if o, loaded = s.dirty.accounts[addr]; !loaded {
		if o, loaded = s.readonly.accounts[addr]; !loaded {
			err = ErrAccountNotFound
			log.WithFields(log.Fields{
				"addr": addr,
			}).WithError(err).Error("unexpected error")
			return
		}
	}
	nonce = o.NextNonce
	return
}

func (s *metaState) increaseNonce(addr proto.AccountAddress) (err error) {
	var (
		src, dst *types.Account
		ok       bool
	)
	if dst, ok = s.dirty.accounts[addr]; !ok {
		if src, ok = s.readonly.accounts[addr]; !ok {
			return ErrAccountNotFound
		}
		dst = deepcopy.Copy(src).(*types.Account)
		s.dirty.accounts[addr] = dst
	}
	dst.NextNonce++
	return
}

// updateProviderList registers a provider.
func (s *metaState) updateProviderList(tx *types.ProvideService, height uint32) (err error) {
	sender, err := crypto.PubKeyHash(tx.Signee)
	if err != nil {
		err = errors.Wrap(err, "updateProviderList failed")
		return
	}

	// Delete previous provider object if exists
	if _, loaded := s.loadProviderObject(sender); loaded {
		s.deleteProviderObject(sender)
	}

	// Register provider metadata (staking verified on-chain)
	pp := types.ProviderProfile{
		Provider:      sender,
		Space:         tx.Space,
		Memory:        tx.Memory,
		LoadAvgPerCPU: tx.LoadAvgPerCPU,
		TargetUser:    tx.TargetUser,
		NodeID:        tx.NodeID,
	}
	s.dirty.provider[sender] = &pp
	return
}

// matchProvidersWithUser creates a database with miners.
func (s *metaState) matchProvidersWithUser(tx *types.CreateDatabase) (err error) {
	log.Infof("create database: %s", tx.Hash())
	sender, err := crypto.PubKeyHash(tx.Signee)
	if err != nil {
		err = errors.Wrap(err, "matchProviders failed")
		return
	}
	if sender != tx.Owner {
		err = errors.Wrapf(ErrInvalidSender, "match failed with real sender: %s, sender: %s",
			sender, tx.Owner)
		return
	}

	if tx.ResourceMeta.Node <= 0 {
		err = ErrInvalidMinerCount
		return
	}
	minerCount := uint64(tx.ResourceMeta.Node)

	miners := make(MinerInfos, 0, minerCount)

	for _, m := range tx.ResourceMeta.TargetMiners {
		if po, loaded := s.loadProviderObject(m); !loaded {
			log.WithFields(log.Fields{
				"miner_addr": m,
				"user_addr":  sender,
			}).Error(err)
			err = ErrNoSuchMiner
			continue
		} else {
			miners, err = filterAndAppendMiner(miners, po, tx, sender)
			if err != nil {
				log.Warnf("miner filtered %v", err)
			}
			// if got enough, break
			if uint64(miners.Len()) == minerCount {
				break
			}
		}
	}

	// not enough, find more miner(s)
	if uint64(miners.Len()) < minerCount {
		if uint64(len(tx.ResourceMeta.TargetMiners)) >= minerCount {
			err = errors.Wrapf(err, "miners match target are not enough %d:%d", miners.Len(), minerCount)
			return
		}
		var newMiners MinerInfos
		// create new merged map
		newMiners, err = s.filterNMiners(tx, sender, int(minerCount)-miners.Len())
		if err != nil {
			return
		}

		miners = append(miners, newMiners...)
	}

	// generate new sqlchain id and address
	dbID := proto.FromAccountAndNonce(tx.Owner, uint32(tx.Nonce))
	dbAddr, err := dbID.AccountAddress()
	if err != nil {
		err = errors.Wrapf(err, "unexpected error when convert database id: %v", dbID)
		return
	}

	users := make([]*types.SQLChainUser, 1)
	users[0] = &types.SQLChainUser{
		Address:    sender,
		Permission: types.UserPermissionFromRole(types.Admin),
		Status:     types.Normal,
	}

	// generate genesis block
	gb, err := s.generateGenesisBlock(dbID, tx)
	if err != nil {
		log.WithFields(log.Fields{
			"dbID":         dbID,
			"resourceMeta": tx.ResourceMeta,
		}).WithError(err).Error("unexpected error")
		return err
	}

	// Encode genesis block
	var enc *bytes.Buffer
	if enc, err = utils.EncodeMsgPack(gb); err != nil {
		log.WithFields(log.Fields{
			"dbID": dbID,
		}).WithError(err).Error("failed to encode genesis block")
		return
	}

	// create sqlchain
	sp := &types.SQLChainProfile{
		ID:                dbID,
		Address:           dbAddr,
		Period:            sqlchainPeriod,
		LastUpdatedHeight: 0,
		Owner:             sender,
		Miners:            miners,
		Users:             users,
		EncodedGenesis:    enc.Bytes(),
		Meta:              tx.ResourceMeta,
	}

	if _, loaded := s.loadSQLChainObject(dbID); loaded {
		err = errors.Wrapf(ErrDatabaseExists, "database exists: %s", dbID)
		return
	}
	s.dirty.accounts[dbAddr] = &types.Account{Address: dbAddr}
	s.dirty.databases[dbID] = sp
	for _, miner := range miners {
		s.deleteProviderObject(miner.Address)
	}
	log.Infof("success create sqlchain with database ID: %s", dbID)
	return
}

func (s *metaState) filterNMiners(
	tx *types.CreateDatabase,
	user proto.AccountAddress,
	minerCount int) (
	m MinerInfos, err error,
) {
	// create new merged map
	allProviderMap := make(map[proto.AccountAddress]*types.ProviderProfile)
	for k, v := range s.readonly.provider {
		allProviderMap[k] = v
	}
	for k, v := range s.dirty.provider {
		if v == nil {
			delete(allProviderMap, k)
		} else {
			allProviderMap[k] = v
		}
	}

	// delete selected target miners
	for _, m := range tx.ResourceMeta.TargetMiners {
		delete(allProviderMap, m)
	}

	// suppose 1/4 miners match
	newMiners := make(MinerInfos, 0, len(allProviderMap)/4)
	// filter all miners to slice and sort
	for _, po := range allProviderMap {
		newMiners, _ = filterAndAppendMiner(newMiners, po, tx, user)
	}
	if newMiners.Len() < minerCount {
		err = ErrNoEnoughMiner
		return
	}

	sort.Slice(newMiners, newMiners.Less)
	return newMiners[:minerCount], nil
}

func filterAndAppendMiner(
	miners MinerInfos,
	po *types.ProviderProfile,
	req *types.CreateDatabase,
	user proto.AccountAddress,
) (newMiners MinerInfos, err error) {
	newMiners = miners
	if !isProviderUserMatch(po.TargetUser, user) {
		err = ErrMinerUserNotMatch
		return
	}
	var match bool
	if match, err = isProviderReqMatch(po, req); !match {
		return
	}
	newMiners = append(miners, &types.MinerInfo{
		Address: po.Provider,
		NodeID:  po.NodeID,
	})
	return
}

func isProviderUserMatch(targetUsers []proto.AccountAddress, user proto.AccountAddress) (match bool) {
	if len(targetUsers) > 0 {
		for _, u := range targetUsers {
			if u == user {
				match = true
			}
		}
	} else {
		match = true
	}
	return
}

func isProviderReqMatch(po *types.ProviderProfile, req *types.CreateDatabase) (match bool, err error) {
	if req.ResourceMeta.LoadAvgPerCPU > 0.0 && po.LoadAvgPerCPU > req.ResourceMeta.LoadAvgPerCPU {
		err = errors.New("load average mismatch")
		log.WithError(err).Debugf("miner's LoadAvgPerCPU: %f, user's LoadAvgPerCPU: %f",
			po.LoadAvgPerCPU, req.ResourceMeta.LoadAvgPerCPU)
		return
	}
	if po.Memory < req.ResourceMeta.Memory {
		err = errors.New("memory mismatch")
		log.WithError(err).Debugf("miner's memory: %d, user's memory: %d",
			po.Memory, req.ResourceMeta.Memory)
		return
	}
	if po.Space < req.ResourceMeta.Space {
		err = errors.New("disk space mismatch")
		log.WithError(err).Debugf("miner's disk space: %d, user's disk space: %d",
			po.Space, req.ResourceMeta.Space)
		return
	}

	return true, nil
}

func (s *metaState) updatePermission(tx *types.UpdatePermission) (err error) {
	log.WithFields(log.Fields{
		"tx_hash":     tx.Hash(),
		"sender":      tx.GetAccountAddress(),
		"db_id":       tx.TargetSQLChain,
		"target_user": tx.TargetUser,
	}).Debug("in updatePermission")
	sender, err := crypto.PubKeyHash(tx.Signee)
	if err != nil {
		log.WithFields(log.Fields{
			"tx": tx.Hash(),
		}).WithError(err).Error("unexpected err")
		return
	}
	so, loaded := s.loadSQLChainObject(tx.TargetSQLChain.DatabaseID())
	if !loaded {
		log.WithFields(log.Fields{
			"dbID": tx.TargetSQLChain.DatabaseID(),
		}).WithError(ErrDatabaseNotFound).Error("unexpected error in updatePermission")
		return ErrDatabaseNotFound
	}

	// check whether sender has super privilege and find targetUser
	numOfSuperUsers := 0
	targetUserIndex := -1
	for i, u := range so.Users {
		if sender == u.Address && !u.Permission.HasSuperPermission() {
			log.WithFields(log.Fields{
				"sender": sender,
				"dbID":   tx.TargetSQLChain,
			}).WithError(ErrAccountPermissionDeny).Error("unexpected error in updatePermission")
			return ErrAccountPermissionDeny
		}
		if u.Permission.HasSuperPermission() {
			numOfSuperUsers++
		}
		if tx.TargetUser == u.Address {
			targetUserIndex = i
		}
	}

	// return error if number of Admin <= 1 and Admin want to revoke permission of itself
	if numOfSuperUsers <= 1 && tx.TargetUser == sender && !tx.Permission.HasSuperPermission() {
		err = ErrNoSuperUserLeft
		log.WithFields(log.Fields{
			"sender":     sender,
			"dbID":       tx.TargetSQLChain,
			"targetUser": tx.TargetUser,
		}).WithError(err).Warning("in updatePermission")
		return
	}

	// update targetUser's permission
	if targetUserIndex == -1 {
		u := types.SQLChainUser{
			Address:    tx.TargetUser,
			Permission: tx.Permission,
			Status:     types.UnknownStatus,
		}
		so.Users = append(so.Users, &u)
	} else {
		so.Users[targetUserIndex].Permission = tx.Permission
	}
	s.dirty.databases[tx.TargetSQLChain.DatabaseID()] = so
	return
}

func (s *metaState) updateKeys(tx *types.IssueKeys) (err error) {
	sender := tx.GetAccountAddress()
	so, loaded := s.loadSQLChainObject(tx.TargetSQLChain.DatabaseID())
	if !loaded {
		log.WithFields(log.Fields{
			"dbID": tx.TargetSQLChain.DatabaseID(),
		}).WithError(ErrDatabaseNotFound).Error("unexpected error in updateKeys")
		return ErrDatabaseNotFound
	}

	// check sender's permission
	for _, user := range so.Users {
		if sender == user.Address {
			if !user.Permission.HasSuperPermission() {
				log.WithFields(log.Fields{
					"sender": sender,
					"dbID":   tx.TargetSQLChain,
				}).WithError(ErrAccountPermissionDeny).Error("unexpected error in updateKeys")
				return ErrAccountPermissionDeny
			}

			break
		}
	}

	// update miner's key
	keyMap := make(map[proto.AccountAddress]string)
	for i := range tx.MinerKeys {
		keyMap[tx.MinerKeys[i].Miner] = tx.MinerKeys[i].EncryptionKey
	}
	for _, miner := range so.Miners {
		if key, ok := keyMap[miner.Address]; ok {
			miner.EncryptionKey = key
		}
	}
	return
}

func (s *metaState) loadROSQLChains(addr proto.AccountAddress) (dbs []*types.SQLChainProfile) {
	for _, db := range s.readonly.databases {
		for _, miner := range db.Miners {
			if miner.Address == addr {
				var dst = deepcopy.Copy(db).(*types.SQLChainProfile)
				dbs = append(dbs, dst)
			}
		}
	}
	return
}

func (s *metaState) applyTransaction(tx pi.Transaction, height uint32) (err error) {
	switch t := tx.(type) {
	case *types.BaseAccount:
		err = s.storeBaseAccount(t.Address, &t.Account)
	case *types.ProvideService:
		err = s.updateProviderList(t, height)
	case *types.CreateDatabase:
		err = s.matchProvidersWithUser(t)
	case *types.UpdatePermission:
		err = s.updatePermission(t)
	case *types.IssueKeys:
		err = s.updateKeys(t)
	case *pi.TransactionWrapper:
		// call again using unwrapped transaction
		err = s.applyTransaction(t.Unwrap(), height)
	default:
		err = ErrUnknownTransactionType
	}
	return
}

func (s *metaState) generateGenesisBlock(dbID proto.DatabaseID, tx *types.CreateDatabase) (genesisBlock *types.Block, err error) {
	emptyNode := &proto.RawNodeID{}
	genesisBlock = &types.Block{
		SignedHeader: types.SignedHeader{
			Header: types.Header{
				Version:   0x01000000,
				Producer:  emptyNode.ToNodeID(),
				Timestamp: tx.Timestamp,
			},
		},
	}

	err = genesisBlock.PackAsGenesis()

	return
}

func (s *metaState) apply(t pi.Transaction, height uint32) (err error) {
	// NOTE(leventeliu): bypass pool in this method.
	var (
		addr  = t.GetAccountAddress()
		nonce = t.GetAccountNonce()
		ttype = t.GetTransactionType()
	)
	log.WithFields(log.Fields{
		"type":  ttype,
		"hash":  t.Hash(),
		"addr":  addr,
		"nonce": nonce,
	}).Infof("apply tx")
	// Check account nonce
	var nextNonce pi.AccountNonce
	if nextNonce, err = s.nextNonce(addr); err != nil {
		if ttype != pi.TransactionTypeBaseAccount {
			return
		}
		// Consider the first nonce 0
		err = nil
	}
	if nextNonce != nonce {
		err = ErrInvalidAccountNonce
		log.WithFields(log.Fields{
			"actual":   nonce,
			"expected": nextNonce,
		}).WithError(err).Debug("nonce not match during transaction apply")
		return
	}
	// Try to apply transaction to metaState
	if err = s.applyTransaction(t, height); err != nil {
		log.WithError(err).Debug("apply transaction failed")
		return
	}
	if err = s.increaseNonce(addr); err != nil {
		return
	}
	return
}

func (s *metaState) makeCopy() *metaState {
	return &metaState{
		dirty:    newMetaIndex(),
		readonly: s.readonly.deepCopy(),
	}
}

// compileChanges compiles storage procedures for changes in dirty map.
func (s *metaState) compileChanges(
	dst []storageProcedure) (results []storageProcedure,
) {
	results = dst
	for k, v := range s.dirty.accounts {
		if v != nil {
			results = append(results, updateAccount(v))
		} else {
			results = append(results, deleteAccount(k))
		}
	}
	for k, v := range s.dirty.databases {
		if v != nil {
			results = append(results, updateShardChain(v))
		} else {
			results = append(results, deleteShardChain(k))
		}
	}
	for k, v := range s.dirty.provider {
		if v != nil {
			results = append(results, updateProvider(v))
		} else {
			results = append(results, deleteProvider(k))
		}
	}
	return
}
