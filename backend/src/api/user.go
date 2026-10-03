package api

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"time"

	"eylexander/ytdlp-ui/backend/src/controller"
	"eylexander/ytdlp-ui/backend/src/models"
)

// RequireAuth rejects requests without a valid session cookie.
func (a *API) RequireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(cookieName)
		if err != nil {
			writeErr(w, http.StatusUnauthorized, models.UserErr("login_required", "Please log in", nil))
			return
		}
		if _, ok := a.ctrl.VerifyToken(c.Value); !ok {
			writeErr(w, http.StatusUnauthorized, models.UserErr("session_expired", "Your session has expired, please log in again", nil))
			return
		}
		next(w, r)
	}
}

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
	if err != nil {
		status := http.StatusUnauthorized
		if err != controller.ErrBadCredentials {
			status = http.StatusTooManyRequests
		}
		writeErr(w, status, err)
		return
	}
	a.setSession(w, r, token, exp)
	w.WriteHeader(http.StatusNoContent)
}

func (a *API) setSession(w http.ResponseWriter, r *http.Request, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", Expires: exp,
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: a.cfg.SecureCookie || r.TLS != nil,
	})
}

// UpdateAccount changes the login. The current session gets a new cookie; all others end.
func (a *API) UpdateAccount(w http.ResponseWriter, r *http.Request) {
	var body struct{ CurrentPassword, Username, NewPassword string }
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, errInvalidRequest)
		return
	}
	token, exp, err := a.ctrl.UpdateAccount(a.clientIP(r), body.CurrentPassword, body.Username, body.NewPassword)
	var ue *models.UserError
	switch {
	case err == nil:
		a.setSession(w, r, token, exp)
		w.WriteHeader(http.StatusNoContent)
	case err == controller.ErrWrongPassword:
		writeErr(w, http.StatusForbidden, err) // not 401: the session itself is fine
	case errors.As(err, &ue) && ue.Code == "too_many_attempts":
		writeErr(w, http.StatusTooManyRequests, err)
	case errors.As(err, &ue) && ue.Code == "account_save_failed":
		writeErr(w, http.StatusInternalServerError, err)
	default:
		writeErr(w, http.StatusBadRequest, err)
	}
}

func (a *API) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(http.StatusNoContent)
}

// Me is behind RequireAuth, so the cookie is known to be valid.
func (a *API) Me(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie(cookieName)
	user, _ := a.ctrl.VerifyToken(c.Value)
	writeJSON(w, http.StatusOK, map[string]string{"username": user})
}
