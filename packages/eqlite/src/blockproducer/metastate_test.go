
package blockproducer

import (
	"os"
	"testing"

	. "github.com/smartystreets/goconvey/convey"

	pi "eqlite/src/blockproducer/interfaces"
	"eqlite/src/conf"
	"eqlite/src/crypto"
	"eqlite/src/crypto/asymmetric"
	"eqlite/src/crypto/hash"
	"eqlite/src/crypto/kms"
	"eqlite/src/proto"
	"eqlite/src/route"
	"eqlite/src/types"
	"eqlite/src/utils/log"
)

func TestMetaState(t *testing.T) {
	Convey("Given a new metaState object and a persistence db instance", t, func() {
		var (
			ao       *types.Account
			co       *types.SQLChainProfile
			po       *types.ProviderProfile
			loaded   bool
			err      error
			privKey1 *asymmetric.PrivateKey
			privKey2 *asymmetric.PrivateKey
			privKey3 *asymmetric.PrivateKey
			privKey4 *asymmetric.PrivateKey
			addr1    proto.AccountAddress
			addr2    proto.AccountAddress
			addr3    proto.AccountAddress
			addr4    proto.AccountAddress
			dbID1    = proto.DatabaseID("db#1")
			dbID2    = proto.DatabaseID("db#2")
			dbID3    = proto.DatabaseID("db#3")
			ms       = newMetaState()
		)
		So(err, ShouldBeNil)

		// Create key pairs and addresses for test
		privKey1, _, err = asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		privKey2, _, err = asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		privKey3, _, err = asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		privKey4, _, err = asymmetric.GenSecp256k1KeyPair()
		So(err, ShouldBeNil)
		addr1, err = crypto.PubKeyHash(privKey1.PubKey())
		So(err, ShouldBeNil)
		addr2, err = crypto.PubKeyHash(privKey2.PubKey())
		So(err, ShouldBeNil)
		addr3, err = crypto.PubKeyHash(privKey3.PubKey())
		So(err, ShouldBeNil)
		addr4, err = crypto.PubKeyHash(privKey4.PubKey())
		So(err, ShouldBeNil)

		Convey("The account state should be empty", func() {
			ao, loaded = ms.loadAccountObject(addr1)
			So(ao, ShouldBeNil)
			So(loaded, ShouldBeFalse)
		})
		Convey("The database state should be empty", func() {
			co, loaded = ms.loadSQLChainObject(dbID1)
			So(co, ShouldBeNil)
			So(loaded, ShouldBeFalse)
		})
		Convey("The provider state should be empty", func() {
			po, loaded = ms.loadProviderObject(addr1)
			So(po, ShouldBeNil)
			So(loaded, ShouldBeFalse)
		})
		Convey("The nonce state should be empty", func() {
			_, err = ms.nextNonce(addr1)
			So(err, ShouldEqual, ErrAccountNotFound)
			err = ms.increaseNonce(addr1)
			So(err, ShouldEqual, ErrAccountNotFound)
		})
		Convey("The metaState should fail to operate SQLChain for unknown user", func() {
			err = ms.createSQLChain(addr1, dbID1)
			So(err, ShouldEqual, ErrAccountNotFound)
			err = ms.addSQLChainUser(dbID1, addr1, types.UserPermissionFromRole(types.Admin))
			So(err, ShouldEqual, ErrDatabaseNotFound)
			err = ms.deleteSQLChainUser(dbID1, addr1)
			So(err, ShouldEqual, ErrDatabaseNotFound)
			err = ms.alterSQLChainUser(dbID1, addr1, types.UserPermissionFromRole(types.Write))
			So(err, ShouldEqual, ErrDatabaseNotFound)
		})
		Convey("When new account and database objects are stored", func() {
			ao, loaded = ms.loadOrStoreAccountObject(addr1, &types.Account{Address: addr1})
			So(ao, ShouldBeNil)
			So(loaded, ShouldBeFalse)
			ao, loaded = ms.loadOrStoreAccountObject(addr2, &types.Account{Address: addr2})
			So(ao, ShouldBeNil)
			So(loaded, ShouldBeFalse)
			co, loaded = ms.loadOrStoreSQLChainObject(dbID1, &types.SQLChainProfile{
				ID: dbID1,
				Miners: []*types.MinerInfo{
					{Address: addr1},
					{Address: addr2},
				},
			})
			So(co, ShouldBeNil)
			So(loaded, ShouldBeFalse)
			co, loaded = ms.loadOrStoreSQLChainObject(dbID2, &types.SQLChainProfile{
				ID: dbID2,
				Miners: []*types.MinerInfo{
					{Address: addr2},
					{Address: addr3},
				},
			})
			So(co, ShouldBeNil)
			So(loaded, ShouldBeFalse)
			Convey("The state should include the account and database objects", func() {
				ao, loaded = ms.loadAccountObject(addr1)
				So(loaded, ShouldBeTrue)
				So(ao, ShouldNotBeNil)
				So(ao.Address, ShouldEqual, addr1)
				ao, loaded = ms.loadOrStoreAccountObject(addr1, nil)
				So(loaded, ShouldBeTrue)
				So(ao, ShouldNotBeNil)
				So(ao.Address, ShouldEqual, addr1)
				co, loaded = ms.loadSQLChainObject(dbID1)
				So(loaded, ShouldBeTrue)
				So(co, ShouldNotBeNil)
				So(co.ID, ShouldEqual, dbID1)
				co, loaded = ms.loadOrStoreSQLChainObject(dbID1, nil)
				So(loaded, ShouldBeTrue)
				So(co, ShouldNotBeNil)
				So(co.ID, ShouldEqual, dbID1)
			})
			Convey("When new SQLChain is created", func() {
				err = ms.createSQLChain(addr1, dbID3)
				So(err, ShouldBeNil)
				Convey("The metaState object should report database exists", func() {
					err = ms.createSQLChain(addr1, dbID3)
					So(err, ShouldEqual, ErrDatabaseExists)
				})
				Convey("When new SQLChain users are added", func() {
					err = ms.addSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Write))
					So(err, ShouldBeNil)
					err = ms.addSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Write))
					So(err, ShouldEqual, ErrDatabaseUserExists)
					Convey("The metaState object should be ok to delete user", func() {
						err = ms.deleteSQLChainUser(dbID3, addr2)
						So(err, ShouldBeNil)
						err = ms.deleteSQLChainUser(dbID3, addr2)
						So(err, ShouldBeNil)
					})
					Convey("The metaState object should be ok to alter user", func() {
						err = ms.alterSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Read))
						So(err, ShouldBeNil)
						err = ms.alterSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Write))
						So(err, ShouldBeNil)
					})
					Convey("When metaState change is committed", func() {
						ms.commit()
						Convey("The metaState object should return correct db list", func() {
							var dbs []*types.SQLChainProfile
							dbs = ms.loadROSQLChains(addr1)
							So(len(dbs), ShouldEqual, 1)
							dbs = ms.loadROSQLChains(addr2)
							So(len(dbs), ShouldEqual, 2)
							dbs = ms.loadROSQLChains(addr4)
							So(dbs, ShouldBeEmpty)
						})
						Convey("The metaState object should be ok to delete user", func() {
							err = ms.deleteSQLChainUser(dbID3, addr2)
							So(err, ShouldBeNil)
							err = ms.deleteSQLChainUser(dbID3, addr2)
							So(err, ShouldBeNil)
						})
						Convey("The metaState object should be ok to alter user", func() {
							err = ms.alterSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Read))
							So(err, ShouldBeNil)
							err = ms.alterSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Write))
							So(err, ShouldBeNil)
						})
					})
				})
				Convey("When metaState change is committed", func() {
					ms.commit()
					Convey("The metaState object should be ok to add users for database", func() {
						err = ms.addSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Write))
						So(err, ShouldBeNil)
						err = ms.addSQLChainUser(dbID3, addr2, types.UserPermissionFromRole(types.Write))
						So(err, ShouldEqual, ErrDatabaseUserExists)
					})
					Convey("The metaState object should report database exists", func() {
						err = ms.createSQLChain(addr1, dbID3)
						So(err, ShouldEqual, ErrDatabaseExists)
					})
				})
			})
			Convey("When nonce operations are performed", func() {
				ms.commit()
				Convey("The metaState should copy object when nonce increased", func() {
					err = ms.increaseNonce(addr1)
					So(err, ShouldBeNil)
					nonce, err := ms.nextNonce(addr1)
					So(err, ShouldBeNil)
					So(nonce, ShouldEqual, 1)
				})
			})
			Convey("When all the above modification are reset", func() {
				ms.clean()
				Convey("The account state should be empty", func() {
					ao, loaded = ms.loadAccountObject(addr1)
					So(ao, ShouldBeNil)
					So(loaded, ShouldBeFalse)
				})
				Convey("The database state should be empty", func() {
					co, loaded = ms.loadSQLChainObject(dbID1)
					So(co, ShouldBeNil)
					So(loaded, ShouldBeFalse)
				})
			})
			Convey("When metaState changes are committed", func() {
				ms.commit()
				Convey("The cached object should be retrievable from readonly map", func() {
					var loaded bool
					_, loaded = ms.loadAccountObject(addr1)
					So(loaded, ShouldBeTrue)
					_, loaded = ms.loadOrStoreAccountObject(addr1, nil)
					So(loaded, ShouldBeTrue)
					_, loaded = ms.loadSQLChainObject(dbID1)
					So(loaded, ShouldBeTrue)
					_, loaded = ms.loadOrStoreSQLChainObject(dbID2, nil)
					So(loaded, ShouldBeTrue)
				})
				Convey("When some objects are deleted", func() {
					ms.deleteAccountObject(addr1)
					ms.deleteSQLChainObject(dbID1)
					Convey("The dirty map should return deleted states of these objects", func() {
						_, loaded = ms.loadAccountObject(addr1)
						So(loaded, ShouldBeFalse)
						_, loaded = ms.loadSQLChainObject(dbID1)
						So(loaded, ShouldBeFalse)
					})
				})
			})
			Convey("When transactions are added", func() {
				var (
					n  pi.AccountNonce
					t0 = types.NewBaseAccount(&types.Account{
						Address: addr1,
					})
				)
				err = ms.apply(t0, 0)
				So(err, ShouldBeNil)
				ms.commit()

				Convey("The metaState should automatically increase nonce", func() {
					n, err = ms.nextNonce(addr1)
					So(err, ShouldBeNil)
					So(n, ShouldEqual, 1)
				})
				Convey("The metaState should report error on unknown transaction type", func() {
					err = ms.applyTransaction(nil, 0)
					So(err, ShouldEqual, ErrUnknownTransactionType)
				})
			})
		})
		Convey("When base account txs are added", func() {
			var txs = []pi.Transaction{
				types.NewBaseAccount(&types.Account{Address: addr1}),
				types.NewBaseAccount(&types.Account{Address: addr2}),
			}
			txs[0].Sign(privKey1)
			txs[1].Sign(privKey2)
			for _, tx := range txs {
				err = ms.apply(tx, 0)
				So(err, ShouldBeNil)
			}
			ms.commit()
			Convey("The accounts should exist", func() {
				_, loaded = ms.loadAccountObject(addr1)
				So(loaded, ShouldBeTrue)
				_, loaded = ms.loadAccountObject(addr2)
				So(loaded, ShouldBeTrue)
			})
		})
		Convey("When SQLChain are created", func() {
			conf.GConf, err = conf.LoadConfig("../test/node_standalone/config.yaml")
			So(err, ShouldBeNil)

			privKeyFile := "../test/node_standalone/private.key"
			pubKeyFile := "../test/node_standalone/public.keystore"
			os.Remove(pubKeyFile)
			defer os.Remove(pubKeyFile)
			route.Once.Reset()
			route.InitKMS(pubKeyFile)
			err = kms.InitLocalKeyPair(privKeyFile, []byte(""))
			So(err, ShouldBeNil)

			ao, loaded = ms.loadOrStoreAccountObject(addr1, &types.Account{Address: addr1})
			So(ao, ShouldBeNil)
			So(loaded, ShouldBeFalse)
			ao, loaded = ms.loadOrStoreAccountObject(addr2, &types.Account{Address: addr2})
			So(ao, ShouldBeNil)
			So(loaded, ShouldBeFalse)
			ao, loaded = ms.loadOrStoreAccountObject(addr3, &types.Account{Address: addr3})
			So(ao, ShouldBeNil)
			So(loaded, ShouldBeFalse)
			ao, loaded = ms.loadOrStoreAccountObject(addr4, &types.Account{Address: addr4})
			So(ao, ShouldBeNil)
			So(loaded, ShouldBeFalse)

			var txs = []pi.Transaction{
				types.NewBaseAccount(&types.Account{Address: addr1}),
				types.NewBaseAccount(&types.Account{Address: addr2}),
				types.NewBaseAccount(&types.Account{Address: addr3}),
				types.NewBaseAccount(&types.Account{Address: addr4}),
			}

			err = txs[0].Sign(privKey1)
			So(err, ShouldBeNil)
			err = txs[1].Sign(privKey2)
			So(err, ShouldBeNil)
			err = txs[2].Sign(privKey3)
			So(err, ShouldBeNil)
			err = txs[3].Sign(privKey4)
			So(err, ShouldBeNil)
			for i := range txs {
				err = ms.apply(txs[i], 0)
				So(err, ShouldBeNil)
				ms.commit()
			}

			Convey("When provider and database creation transactions are processed", func() {
				ps := types.ProvideService{
					ProvideServiceHeader: types.ProvideServiceHeader{
						TargetUser: []proto.AccountAddress{addr1},
						Nonce:      1,
					},
				}
				err = ps.Sign(privKey2)
				So(err, ShouldBeNil)

				err = ms.apply(&ps, 0)
				So(err, ShouldBeNil)
				ms.commit()

				po, loaded = ms.loadProviderObject(addr2)
				So(loaded, ShouldBeTrue)
				So(po, ShouldNotBeNil)

				// Test provider filtering
				ms.dirty.provider[proto.AccountAddress(hash.HashH([]byte("1")))] = &types.ProviderProfile{
					Provider:      proto.AccountAddress(hash.HashH([]byte("1"))),
					TargetUser:    []proto.AccountAddress{addr1},
					Space:         100,
					Memory:        100,
					LoadAvgPerCPU: 0.001,
					NodeID:        "0000001",
				}
				ms.dirty.provider[proto.AccountAddress(hash.HashH([]byte("2")))] = &types.ProviderProfile{
					Provider:      proto.AccountAddress(hash.HashH([]byte("2"))),
					TargetUser:    []proto.AccountAddress{addr1},
					Space:         100,
					Memory:        100,
					LoadAvgPerCPU: 0.001,
					NodeID:        "0000002",
				}
				ms.commit()

				cd := types.CreateDatabase{
					CreateDatabaseHeader: types.CreateDatabaseHeader{
						Owner: addr1,
						ResourceMeta: types.ResourceMeta{
							TargetMiners: []proto.AccountAddress{
								proto.AccountAddress(hash.HashH([]byte("1"))),
								proto.AccountAddress(hash.HashH([]byte("2"))),
							},
							Node: 2,
						},
						Nonce: 1,
					},
				}
				err = cd.Sign(privKey1)
				So(err, ShouldBeNil)

				err = ms.apply(&cd, 0)
				So(err, ShouldBeNil)
				ms.commit()

				dbID := proto.FromAccountAndNonce(addr1, uint32(cd.Nonce))
				co, loaded = ms.loadSQLChainObject(dbID)
				So(loaded, ShouldBeTrue)
				So(len(co.Miners), ShouldEqual, 2)

				log.Debugf("Created database: %s with %d miners", dbID, len(co.Miners))
			})
		})
	})
}
