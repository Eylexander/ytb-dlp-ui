package server

import (
	"net/http"

	"eylexander/ytdlp-ui/backend/src/api"
	"eylexander/ytdlp-ui/backend/src/controller"
)

// RequireAuth rejects requests without a valid session cookie.
func RequireAuth(ctrl *controller.Controller, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(api.CookieName)
		if err != nil {
			unauthorized(w, "login_required", "Please log in")
			return
		}
		if _, ok := ctrl.VerifyToken(c.Value); !ok {
			unauthorized(w, "session_expired", "Your session has expired, please log in again")
			return
		}
		next(w, r)
	}
}

func unauthorized(w http.ResponseWriter, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"code":"` + code + `","error":"` + msg + `"}`))
}
