package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	DatabaseURL string
	Port        string
	CORSOrigin  string
}

func Load() Config {
	loadDotEnv(".env")
	loadDotEnv(filepath.Join("..", ".env"))

	return Config{
		DatabaseURL: getEnv("DATABASE_URL", "postgres://stockflow:stockflow@localhost:5432/stockflow?sslmode=disable"),
		Port:        getEnv("API_PORT", "8080"),
		CORSOrigin:  getEnv("CORS_ORIGIN", "http://localhost:5173"),
	}
}

func getEnv(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

// loadDotEnv loads KEY=VALUE pairs from a local .env file without overriding existing OS env vars.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		if k != "" && os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}
