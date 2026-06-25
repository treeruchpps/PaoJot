// Package storage จัดการเก็บ/อ่านไฟล์อัปโหลด
//   - ถ้าตั้งค่า R2 ครบ → เก็บบน Cloudflare R2 (S3-compatible)
//   - ถ้าไม่ครบ → fallback เก็บลงโฟลเดอร์ local "uploads/" (สะดวกตอน dev)
package storage

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"

	"paomoney/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type Storage struct {
	client    *s3.Client // nil = local mode
	bucket    string
	publicURL string // R2 public base URL (ไม่มี / ปิดท้าย)
	localBase string // โฟลเดอร์ local เช่น "uploads"
	urlPrefix string // path prefix ที่ serve local เช่น "/uploads"
}

// New สร้าง Storage จาก config — เลือกโหมด R2 หรือ local อัตโนมัติ
func New(cfg *config.Config) *Storage {
	s := &Storage{localBase: "uploads", urlPrefix: "/uploads"}
	if cfg.R2.Enabled() {
		s.client = s3.New(s3.Options{
			Region:       "auto",
			BaseEndpoint: aws.String(cfg.R2.Endpoint()),
			Credentials:  credentials.NewStaticCredentialsProvider(cfg.R2.AccessKey, cfg.R2.SecretKey, ""),
			UsePathStyle: true,
		})
		s.bucket = cfg.R2.Bucket
		s.publicURL = strings.TrimRight(cfg.R2.PublicURL, "/")
	}
	return s
}

// UsingR2 บอกว่ากำลังใช้ R2 อยู่หรือไม่ (false = local)
func (s *Storage) UsingR2() bool { return s.client != nil }

// Upload เก็บไฟล์ภายใต้ key แล้วคืน "location" สำหรับเก็บลง DB
//   - R2 mode  → คืน public URL เต็ม (https://pub-xxx.r2.dev/<key>)
//   - local    → คืน path relative (/uploads/<key>)
func (s *Storage) Upload(ctx context.Context, key, contentType string, data []byte) (string, error) {
	key = strings.TrimPrefix(key, "/")

	if s.client != nil {
		_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
			Bucket:      aws.String(s.bucket),
			Key:         aws.String(key),
			Body:        bytes.NewReader(data),
			ContentType: aws.String(contentType),
		})
		if err != nil {
			return "", err
		}
		return s.publicURL + "/" + key, nil
	}

	full := filepath.Join(s.localBase, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(full), 0755); err != nil {
		return "", err
	}
	if err := os.WriteFile(full, data, 0644); err != nil {
		return "", err
	}
	return s.urlPrefix + "/" + key, nil
}

// Download อ่านไฟล์กลับจาก location ที่เคยเก็บไว้ (รองรับทั้ง R2 URL และ local path)
func (s *Storage) Download(ctx context.Context, location string) ([]byte, error) {
	if s.client != nil && s.publicURL != "" && strings.HasPrefix(location, s.publicURL) {
		key := strings.TrimPrefix(strings.TrimPrefix(location, s.publicURL), "/")
		out, err := s.client.GetObject(ctx, &s3.GetObjectInput{
			Bucket: aws.String(s.bucket),
			Key:    aws.String(key),
		})
		if err != nil {
			return nil, err
		}
		defer out.Body.Close()
		return io.ReadAll(out.Body)
	}

	// local: location เช่น "/uploads/scans/xxx.jpg" → อ่านไฟล์ที่ uploads/scans/xxx.jpg
	p := strings.TrimPrefix(location, "/")
	return os.ReadFile(p)
}
