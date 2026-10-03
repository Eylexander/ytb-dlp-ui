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

// Run serves until ctx is canceled, then stops running downloads before returning.
func Run(ctx context.Context, cfg *models.Config, ctrl *controller.Controller) error {
	// Minimal images ship without /etc/mime.types; the player needs correct types.
	for ext, typ := range map[string]string{
		".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm", ".mkv": "video/x-matroska",
		".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".opus": "audio/ogg", ".ogg": "audio/ogg",
		".flac": "audio/flac", ".wav": "audio/wav", ".aac": "audio/aac",
	} {
		mime.AddExtensionType(ext, typ)
	}

	a, mux := api.NewAPI(cfg, ctrl), http.NewServeMux()
	auth := a.RequireAuth
	mux.HandleFunc("POST /api/login", a.Login)
	mux.HandleFunc("POST /api/logout", a.Logout)
	mux.HandleFunc("GET /api/me", auth(a.Me))
	mux.HandleFunc("PUT /api/account", auth(a.UpdateAccount))
	mux.HandleFunc("GET /api/health", auth(a.Health))
	mux.HandleFunc("POST /api/ytdlp/update", auth(a.UpdateYtDlp))

	mux.HandleFunc("GET /api/downloads", auth(a.ListDownloads))
	mux.HandleFunc("POST /api/downloads", auth(a.CreateDownload))
	mux.HandleFunc("POST /api/downloads/{id}/cancel", auth(a.CancelDownload))
	mux.HandleFunc("DELETE /api/downloads/{id}", auth(a.DeleteDownload))
	mux.HandleFunc("GET /api/downloads/archive", auth(a.DownloadArchive))
	mux.HandleFunc("GET /api/downloads/{id}/file", auth(a.DownloadFile))
	mux.HandleFunc("GET /api/downloads/{id}/thumbnail", auth(a.Thumbnail))

	mux.HandleFunc("/", api.NotFound)

	srv := &http.Server{Addr: cfg.Addr, Handler: mux}
	go func() {
		<-ctx.Done()
		log.Print("shutting down")
		ctrl.Shutdown()
		srv.Close()
	}()
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		return err
	}
	return nil
}
