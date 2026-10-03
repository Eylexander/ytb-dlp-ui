package controller

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"eylexander/ytdlp-ui/backend/src/models"
)

const (
	SessionTTL = 7 * 24 * time.Hour
	maxFails   = 5
	failWindow = 15 * time.Minute
)

var ErrBadCredentials = models.UserErr("bad_credentials", "Wrong username or password", nil)

type LockedError struct{ Wait time.Duration }

func (e LockedError) Minutes() int { return max(int(e.Wait.Round(time.Minute).Minutes()), 1) }

func (e LockedError) Error() string {
	return fmt.Sprintf("Too many failed attempts. Try again in %d min.", e.Minutes())
}

// Single account from env, stateless HMAC-signed session token.
// ponytail: logout only clears the cookie; a stolen token stays valid until expiry. Add a server-side session store if that matters.

func (c *Controller) sign(payload string) string {
	mac := hmac.New(sha256.New, c.cfg.Secret)
	mac.Write([]byte(payload))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func (c *Controller) newToken(user string, exp time.Time) string {
	payload := fmt.Sprintf("%s|%d", user, exp.Unix())
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + c.sign(payload)
}

// VerifyToken returns the user name of a valid, unexpired token.
func (c *Controller) VerifyToken(token string) (string, bool) {
	enc, sig, ok := strings.Cut(token, ".")
	if !ok {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(enc)
	if err != nil || !hmac.Equal([]byte(sig), []byte(c.sign(string(raw)))) {
		return "", false
	}
	i := strings.LastIndexByte(string(raw), '|')
	if i < 0 {
		return "", false
	}
	exp, err := strconv.ParseInt(string(raw[i+1:]), 10, 64)
	if err != nil || time.Now().Unix() > exp {
		return "", false
	}
	return string(raw[:i]), true
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

// Login checks credentials with a per-IP lockout and returns a session token.
func (c *Controller) Login(user, password, ip string) (token string, exp time.Time, err error) {
	c.authMu.Lock()
	recent := c.recentFails(ip)
	c.authMu.Unlock()
	if len(recent) >= maxFails {
		return "", time.Time{}, LockedError{Wait: time.Until(recent[0].Add(failWindow))}
	}

	// Hash first so the comparison is constant-time regardless of length.
	hu, hp := sha256.Sum256([]byte(user)), sha256.Sum256([]byte(password))
	wu, wp := sha256.Sum256([]byte(c.cfg.User)), sha256.Sum256([]byte(c.cfg.Password))
	if subtle.ConstantTimeCompare(hu[:], wu[:])&subtle.ConstantTimeCompare(hp[:], wp[:]) != 1 {
		c.authMu.Lock()
		c.fails[ip] = append(c.fails[ip], time.Now())
		c.authMu.Unlock()
		return "", time.Time{}, ErrBadCredentials
	}

	c.authMu.Lock()
	delete(c.fails, ip)
	c.authMu.Unlock()
	exp = time.Now().Add(SessionTTL)
	return c.newToken(c.cfg.User, exp), exp, nil
}
