package controller

import (
	"context"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"eylexander/ytdlp-ui/backend/src/datastore"
	"eylexander/ytdlp-ui/backend/src/models"
)

const (
	sessionTTL  = 7 * 24 * time.Hour
	maxFails    = 5
	failWindow  = 15 * time.Minute
	minPassword = 8
	iterations  = 600_000 // OWASP's PBKDF2-SHA256 recommendation
)

var (
	ErrBadCredentials = models.UserErr("bad_credentials", "Wrong username or password", nil)
	ErrWrongPassword  = models.UserErr("wrong_password", "Your current password is incorrect", nil)
)

// Single account stored in the database. The first start creates "admin" with a random
// password printed to the log; it's changed in Settings.
// Sessions are stateless HMAC-signed tokens. The signature covers the password hash, so
// changing the password (or the username) logs out every other session.
// ponytail: logout only clears the cookie; a stolen token stays valid until expiry or a
// password change. Add a server-side session store if that matters.

func hashPassword(password string) string {
	salt := make([]byte, 16)
	rand.Read(salt)
	key, _ := pbkdf2.Key(sha256.New, password, salt, iterations, 32)
	enc := base64.RawStdEncoding.EncodeToString
	return fmt.Sprintf("pbkdf2-sha256$%d$%s$%s", iterations, enc(salt), enc(key))
}

func checkPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return false
	}
	iter, err1 := strconv.Atoi(parts[1])
	salt, err2 := base64.RawStdEncoding.DecodeString(parts[2])
	want, err3 := base64.RawStdEncoding.DecodeString(parts[3])
	if err := errors.Join(err1, err2, err3); err != nil {
		return false
	}
	got, err := pbkdf2.Key(sha256.New, password, salt, iter, len(want))
	return err == nil && subtle.ConstantTimeCompare(got, want) == 1
}

// loadAccount reads the account, creating one on the first start.
func (c *Controller) loadAccount() error {
	ctx, cancel := context.WithTimeout(context.Background(), datastore.Timeout)
	defer cancel()
	acc, err := c.db.GetAccount(ctx)
	if err != nil {
		return fmt.Errorf("loading account: %w", err)
	}
	if acc != nil {
		c.account = *acc
		return nil
	}
	password := rand.Text()
	c.account = models.Account{Username: "admin", PasswordHash: hashPassword(password)}
	if err := c.db.SaveAccount(ctx, c.account); err != nil {
		return fmt.Errorf("creating account: %w", err)
	}
	log.Printf("created the account: log in as admin / %s and change it in Settings (shown only once)", password)
	return nil
}

func (c *Controller) currentAccount() models.Account {
	c.authMu.Lock()
	defer c.authMu.Unlock()
	return c.account
}

func (c *Controller) sign(acc models.Account, payload string) string {
	mac := hmac.New(sha256.New, c.cfg.Secret)
	mac.Write([]byte(payload + "\x00" + acc.PasswordHash))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (c *Controller) newToken(acc models.Account) (string, time.Time) {
	exp := time.Now().Add(sessionTTL)
	payload := fmt.Sprintf("%s|%d", acc.Username, exp.Unix())
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + c.sign(acc, payload), exp
}

// VerifyToken returns the user name of a valid, unexpired token.
func (c *Controller) VerifyToken(token string) (string, bool) {
	enc, sig, ok := strings.Cut(token, ".")
	if !ok {
		return "", false
	}
	acc := c.currentAccount()
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil || !hmac.Equal([]byte(sig), []byte(c.sign(acc, string(raw)))) {
		return "", false
	}
	i := strings.LastIndexByte(string(raw), '|')
	if i < 0 || string(raw[:i]) != acc.Username {
		return "", false
	}
	exp, err := strconv.ParseInt(string(raw[i+1:]), 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return "", false
	}
	return acc.Username, true
}

// recentFails prunes and returns failed attempts inside the window. Caller holds c.authMu.
func (c *Controller) recentFails(ip string) []time.Time {
	var recent []time.Time
	for _, t := range c.fails[ip] {
		if time.Since(t) < failWindow {
			recent = append(recent, t)
		}
	}
	c.fails[ip] = recent
	return recent
}

// authenticate checks credentials with a per-IP lockout.
func (c *Controller) authenticate(user, password, ip string) (models.Account, error) {
	c.authMu.Lock()
	recent := c.recentFails(ip)
	acc := c.account
	c.authMu.Unlock()
	if len(recent) >= maxFails {
		m := max(int(time.Until(recent[0].Add(failWindow)).Round(time.Minute).Minutes()), 1)
		return acc, models.UserErr("too_many_attempts",
			fmt.Sprintf("Too many failed attempts. Try again in %d min.", m), map[string]any{"minutes": m})
	}

	// Always hash, so a wrong username takes as long as a wrong password.
	okPass := checkPassword(acc.PasswordHash, password)
	hu, wu := sha256.Sum256([]byte(user)), sha256.Sum256([]byte(acc.Username))
	c.authMu.Lock()
	defer c.authMu.Unlock()
	if subtle.ConstantTimeCompare(hu[:], wu[:]) != 1 || !okPass {
		c.fails[ip] = append(c.fails[ip], time.Now())
		return acc, ErrBadCredentials
	}
	delete(c.fails, ip)
	return acc, nil
}

// Login returns a session token for valid credentials.
func (c *Controller) Login(user, password, ip string) (token string, exp time.Time, err error) {
	acc, err := c.authenticate(user, password, ip)
	if err != nil {
		return "", time.Time{}, err
	}
	token, exp = c.newToken(acc)
	return token, exp, nil
}

// UpdateAccount changes the username and, if newPassword isn't empty, the password. It needs
// the current password and returns a fresh token, since the change invalidates all sessions.
func (c *Controller) UpdateAccount(ip, currentPassword, username, newPassword string) (token string, exp time.Time, err error) {
	username = strings.TrimSpace(username)
	if username == "" || len(username) > 64 {
		return "", time.Time{}, models.UserErr("invalid_username", "The username must be 1 to 64 characters", nil)
	}
	if newPassword != "" && len([]rune(newPassword)) < minPassword {
		return "", time.Time{}, models.UserErr("password_too_short",
			fmt.Sprintf("The new password must be at least %d characters", minPassword), map[string]any{"min": minPassword})
	}
	acc, err := c.authenticate(c.currentAccount().Username, currentPassword, ip)
	if err == ErrBadCredentials {
		return "", time.Time{}, ErrWrongPassword
	} else if err != nil {
		return "", time.Time{}, err
	}

	acc.Username = username
	if newPassword != "" {
		acc.PasswordHash = hashPassword(newPassword)
	}
	ctx, cancel := context.WithTimeout(context.Background(), datastore.Timeout)
	defer cancel()
	if err := c.db.SaveAccount(ctx, acc); err != nil {
		return "", time.Time{}, models.UserErr("account_save_failed", "Saving failed: "+err.Error(), map[string]any{"detail": err.Error()})
	}
	c.authMu.Lock()
	c.account = acc
	c.authMu.Unlock()
	token, exp = c.newToken(acc)
	return token, exp, nil
}
