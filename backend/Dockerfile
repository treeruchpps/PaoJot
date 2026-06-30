# ---- build stage
FROM golang:1.25-alpine AS builder
WORKDIR /app

RUN apk add --no-cache git ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -o server ./cmd/main.go

# ---- run stage
FROM alpine:3.20
RUN apk add --no-cache ca-certificates

WORKDIR /app
RUN adduser -D -g '' appuser
USER appuser

COPY --from=builder /app/server ./server

EXPOSE 8080
CMD ["./server"]
