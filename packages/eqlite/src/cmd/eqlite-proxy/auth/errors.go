
package auth

import "errors"

var (
	// ErrIncorrectPassword define password incorrect error on non-oauth based admin authorization.
	ErrIncorrectPassword = errors.New("incorrect password")
	// ErrOAuthGetUserFailed defines error on failure to fetch user info for oauth process.
	ErrOAuthGetUserFailed = errors.New("get user failed")
	// ErrUnsupportedUserAuthProvider defines error on currently unsupported oauth user provider.
	ErrUnsupportedUserAuthProvider = errors.New("unsupported user auth provider")
)
