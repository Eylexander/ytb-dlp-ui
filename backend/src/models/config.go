package models

// Config is read once from the environment in cmd/main.go.
type Config struct {
	Addr          string
	DataDir       string
	DatabaseURL   string
	YtDlp         string
	MaxConcurrent int
	Secret        []byte
	SecureCookie  bool
	TrustProxy    bool
}
