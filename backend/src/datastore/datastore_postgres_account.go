package datastore

import (
	"context"
	"errors"

	"eylexander/ytdlp-ui/backend/src/models"

	"github.com/jackc/pgx/v5"
)

// GetAccount returns nil, nil when no account has been created yet.
func (ds *PostgresDatastore) GetAccount(ctx context.Context) (*models.Account, error) {
	var a models.Account
	err := ds.pool.QueryRow(ctx, `SELECT username, password_hash FROM account`).Scan(&a.Username, &a.PasswordHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

func (ds *PostgresDatastore) SaveAccount(ctx context.Context, a models.Account) error {
	_, err := ds.pool.Exec(ctx, `
		INSERT INTO account (id, username, password_hash) VALUES (1, $1, $2)
		ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
		a.Username, a.PasswordHash)
	return err
}
