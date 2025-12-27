
package bftraft

import (
	"context"

	"github.com/pkg/errors"

	"eqlite/src/utils/trace"
)

func (r *Runtime) doCheck(ctx context.Context, req interface{}) (err error) {
	defer trace.StartRegion(ctx, "checkCallback").End()
	if err = r.sh.Check(req); err != nil {
		err = errors.Wrap(err, "verify log")
	}

	return
}

func (r *Runtime) doEncodePayload(ctx context.Context, req interface{}) (enc []byte, err error) {
	defer trace.StartRegion(ctx, "encodePayloadCallback").End()
	if enc, err = r.sh.EncodePayload(req); err != nil {
		err = errors.Wrap(err, "encode bftraft payload failed")
	}
	return
}

func (r *Runtime) doDecodePayload(ctx context.Context, data []byte) (req interface{}, err error) {
	defer trace.StartRegion(ctx, "decodePayloadCallback").End()
	if req, err = r.sh.DecodePayload(data); err != nil {
		err = errors.Wrap(err, "decode bftraft payload failed")
	}
	return
}

func (r *Runtime) doCommit(ctx context.Context, req interface{}, isLeader bool) (result interface{}, err error) {
	defer trace.StartRegion(ctx, "commitCallback").End()
	return r.sh.Commit(req, isLeader)
}
