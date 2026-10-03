package datastore

import (
	"context"
	"time"

	"eylexander/ytdlp-ui/backend/src/models"
)

// Timeout bounds every query issued by the controller.
const Timeout = 5 * time.Second

// DataStore defines the interface for database operations
type DataStore interface {
	Close()

	// Downloads
	GetDownloads(ctx context.Context) ([]*models.Job, error)
	SaveDownload(ctx context.Context, j models.Job) error
	DeleteDownload(ctx context.Context, id string) error

	// Account
	GetAccount(ctx context.Context) (*models.Account, error)
	SaveAccount(ctx context.Context, a models.Account) error
}
