package models

// Account is the app's single login. PasswordHash is "pbkdf2-sha256$<iterations>$<salt>$<key>" (base64).
type Account struct {
	Username     string
	PasswordHash string
}
