package main

import (
	"context"
	"crypto/rand"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"eylexander/ytdlp-ui/backend/src/controller"
	"eylexander/ytdlp-ui/backend/src/datastore"
	"eylexander/ytdlp-ui/backend/src/models"
	"eylexander/ytdlp-ui/backend/src/server"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	maxConc, _ := strconv.Atoi(env("MAX_CONCURRENT", "2"))
	cfg := &models.Config{
		Addr:          env("ADDR", ":8080"),
		User:          env("APP_USER", "admin"),
		Password:      os.Getenv("APP_PASSWORD"),
		DataDir:       env("DATA_DIR", "./data"),
		DatabaseURL:   env("DATABASE_URL", "postgres://ytdlp:ytdlp@localhost:5433/ytdlp?sslmode=disable"),
		YtDlp:         env("YTDLP_PATH", "yt-dlp"),
		MaxConcurrent: max(maxConc, 1),
		Secret:        []byte(os.Getenv("SESSION_SECRET")),
		SecureCookie:  os.Getenv("COOKIE_SECURE") == "true",
		TrustProxy:    os.Getenv("TRUST_PROXY") == "true",
	}
	if cfg.Password == "" {
		log.Fatal("APP_PASSWORD must be set")
	}
	if len(cfg.Secret) == 0 {
		// Sessions won't survive a restart without SESSION_SECRET.
		cfg.Secret = make([]byte, 32)
		rand.Read(cfg.Secret)
	}

	dbCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	db, err := datastore.NewPostgres(dbCtx, cfg.DatabaseURL)
	cancel()
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	ctrl, err := controller.NewController(cfg, db)
	if err != nil {
		log.Fatal(err)
	}
	if v := ctrl.YtDlpVersion(); v == "" {
		log.Printf("WARNING: %q not found or not runnable; downloads will fail", cfg.YtDlp)
	} else {
		log.Printf("using yt-dlp %s", v)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("yt-dlp UI server listening on %s", cfg.Addr)
	if err := server.NewServer(cfg, ctrl).Run(ctx, cfg.Addr); err != nil {
		log.Fatal(err)
	}
}
