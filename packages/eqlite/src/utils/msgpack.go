
package utils

import (
	"bytes"
	"io"
	"net/rpc"
	"reflect"

	"github.com/ugorji/go/codec"
)

var msgPackHandle = &codec.MsgpackHandle{
	WriteExt: true,
}

// RegisterInterfaceToMsgPack binds interface decode/encode to specified implementation.
func RegisterInterfaceToMsgPack(intf, impl reflect.Type) (err error) {
	return msgPackHandle.Intf2Impl(intf, impl)
}

// DecodeMsgPack reverses the encode operation on a byte slice input.
func DecodeMsgPack(buf []byte, out interface{}) error {
	dec := codec.NewDecoder(bytes.NewReader(buf), msgPackHandle)
	return dec.Decode(out)
}

// DecodeMsgPackPlain reverses the encode operation on a byte slice input without RawToString setting.
func DecodeMsgPackPlain(buf []byte, out interface{}) error {
	hd := &codec.MsgpackHandle{
		WriteExt: true,
	}
	dec := codec.NewDecoder(bytes.NewReader(buf), hd)
	return dec.Decode(out)
}

// EncodeMsgPack writes an encoded object to a new bytes buffer.
func EncodeMsgPack(in interface{}) (*bytes.Buffer, error) {
	buf := bytes.NewBuffer(nil)
	enc := codec.NewEncoder(buf, msgPackHandle)
	err := enc.Encode(in)
	return buf, err
}

// GetMsgPackServerCodec returns msgpack server codec for connection.
func GetMsgPackServerCodec(c io.ReadWriteCloser) rpc.ServerCodec {
	return codec.MsgpackSpecRpc.ServerCodec(c, msgPackHandle)
}

// GetMsgPackClientCodec returns msgpack client codec for connection.
func GetMsgPackClientCodec(c io.ReadWriteCloser) rpc.ClientCodec {
	return codec.MsgpackSpecRpc.ClientCodec(c, msgPackHandle)
}
