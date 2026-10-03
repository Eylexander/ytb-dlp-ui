package server

import (
	"context"
	"log"
	"mime"
	"net/http"

	"eylexander/ytdlp-ui/backend/src/api"
	"eylexander/ytdlp-ui/backend/src/controller"
	"eylexander/ytdlp-ui/backend/src/models"
)

type Server struct {
	mux  *http.ServeMux
	api  *api.API
	ctrl *controller.Controller
}

func NewServer(cfg *models.Config, ctrl *controller.Controller) *Server {
	// Minimal images ship without /etc/mime.types; the player needs correct types.
	for ext, typ := range map[string]string{
		".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
		".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".opus": "audio/ogg", ".ogg": "audio/ogg",
		".flac": "audio/flac", ".wav": "audio/wav", ".aac": "audio/aac",
	} {
		mime.AddExtensionType(ext, typ)
	}
	s := &Server{mux: http.NewServeMux(), api: api.NewAPI(cfg, ctrl), ctrl: ctrl}
	s.registerRoutes()
	return s
}

func (s *Server) registerRoutes() {
	auth := func(h http.HandlerFunc) http.HandlerFunc { return RequireAuth(s.ctrl, h) }

	s.mux.HandleFunc("POST /api/login", s.api.Login)
	s.mux.HandleFunc("POST /api/logout", s.api.Logout)
	s.mux.HandleFunc("GET /api/me", auth(s.api.Me))
	s.mux.HandleFunc("GET /api/health", auth(s.api.Health))
	s.mux.HandleFunc("POST /api/ytdlp/update", auth(s.api.UpdateYtDlp))

	s.mux.HandleFunc("GET /api/downloads", auth(s.api.ListDownloads))
	s.mux.HandleFunc("POST /api/downloads", auth(s.api.CreateDownload))
	s.mux.HandleFunc("POST /api/downloads/{id}/cancel", auth(s.api.CancelDownload))
	s.mux.HandleFunc("DELETE /api/downloads/{id}", auth(s.api.DeleteDownload))
	s.mux.HandleFunc("GET /api/downloads/archive", auth(s.api.DownloadArchive))
	s.mux.HandleFunc("GET /api/downloads/{id}/file", auth(s.api.DownloadFile))
	s.mux.HandleFunc("GET /api/downloads/{id}/thumbnail", auth(s.api.Thumbnail))

	s.mux.HandleFunc("/", api.NotFound)
}

// Run serves until ctx is canceled, then stops running downloads before returning.
func (s *Server) Run(ctx context.Context, addr string) error {
	srv := &http.Server{Addr: addr, Handler: s.mux}
	go func() {
		<-ctx.Done()
		log.Print("shutting down")
		s.ctrl.Shutdown()
		srv.Close()
	}()
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}
	return nil
}
