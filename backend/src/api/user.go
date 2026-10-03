package api

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"

	"eylexander/ytdlp-ui/backend/src/controller"
	"eylexander/ytdlp-ui/backend/src/models"
)

// clientIP keys the login lockout. X-Real-IP is only trusted behind our own nginx.
func (a *API) clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); a.cfg.TrustProxy && ip != "" {
		return ip
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (a *API) Login(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, errInvalidRequest)
		return
	}
	token, exp, err := a.ctrl.Login(body.Username, body.Password, a.clientIP(r))
	var locked controller.LockedError
	switch {
	case errors.As(err, &locked):
		writeErr(w, http.StatusTooManyRequests, models.UserErr("too_many_attempts", err.Error(), map[string]any{"minutes": locked.Minutes()}))
		return
	case err != nil:
		writeErr(w, http.StatusUnauthorized, err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: CookieName, Value: token, Path: "/", Expires: exp,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.cfg.SecureCookie || r.TLS != nil,
	})
	writeJSON(w, http.StatusOK, map[string]string{"username": a.cfg.User})
}

func (a *API) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(http.StatusNoContent)
}

// Me is behind RequireAuth, so the cookie is known to be valid.
func (a *API) Me(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie(CookieName)
	user, _ := a.ctrl.VerifyToken(c.Value)
	writeJSON(w, http.StatusOK, map[string]string{"username": user})
}
