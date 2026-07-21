# ── 1단계: 프론트엔드 빌드 ──────────────────────────────
FROM node:24-alpine AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── 2단계: 백엔드 빌드 (프론트엔드 임베드) ──────────────
FROM golang:1.26-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /app/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /podview ./cmd/server

# ── 3단계: 실행 이미지 ──────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /podview /podview
EXPOSE 8080
ENTRYPOINT ["/podview"]
