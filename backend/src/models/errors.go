package models

// UserError is an error meant for the end user. The API sends Code (and Params) so the
// frontend can show it in the user's language (frontend/messages/*.json, "apiErrors"),
// with Msg as the English fallback.
type UserError struct {
	Code   string
	Msg    string
	Params map[string]any
}

func (e *UserError) Error() string { return e.Msg }

func UserErr(code, msg string, params map[string]any) *UserError {
	return &UserError{Code: code, Msg: msg, Params: params}
}
