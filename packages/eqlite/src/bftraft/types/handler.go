
package types

// Handler defines the main underlying fsm of bftraft.
type Handler interface {
	EncodePayload(req interface{}) (data []byte, err error)
	DecodePayload(data []byte) (req interface{}, err error)
	Check(request interface{}) error
	Commit(request interface{}, isLeader bool) (result interface{}, err error)
}
