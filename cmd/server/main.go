package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/pms241948/kube-podview/internal/api"
	"github.com/pms241948/kube-podview/internal/auth"
	"github.com/pms241948/kube-podview/internal/config"
	"github.com/pms241948/kube-podview/internal/gateway"
	"github.com/pms241948/kube-podview/internal/k8s"
	"github.com/pms241948/kube-podview/internal/prom"
	"github.com/pms241948/kube-podview/internal/store"
	"github.com/pms241948/kube-podview/web"
	"k8s.io/client-go/kubernetes"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("설정 로드 실패", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	clients, err := k8s.NewClients(cfg.Kubeconfig)
	if err != nil {
		slog.Error("쿠버네티스 클라이언트 생성 실패", "error", err)
		os.Exit(1)
	}

	hub := k8s.NewHub(clients.Core)
	if err := hub.Start(ctx); err != nil {
		slog.Error("파드 인포머 시작 실패", "error", err)
		os.Exit(1)
	}

	trafficProvider := prom.New(prom.Config{
		PrometheusURL: cfg.Traffic.PrometheusURL,
		EdgeQuery:     cfg.Traffic.EdgeQuery,
		EdgeUnit:      cfg.Traffic.EdgeUnit,
		GPUUtilQuery:  cfg.Traffic.GPUUtilQuery,
		GPUMemQuery:   cfg.Traffic.GPUMemQuery,
	})
	if trafficProvider != nil {
		slog.Info("트래픽 조회 활성화 (Prometheus)", "url", cfg.Traffic.PrometheusURL)
	}

	// 런타임 설정 저장소: in-cluster면 Secret, 로컬이면 파일
	var storeClient kubernetes.Interface
	if cfg.PodNamespace != "" {
		storeClient = clients.Core
	}
	settings, err := store.NewManager(storeClient, cfg.PodNamespace, cfg.DataDir)
	if err != nil {
		slog.Error("설정 저장소 초기화 실패", "error", err)
		os.Exit(1)
	}

	mux := http.NewServeMux()
	apiServer := api.New(clients, hub, trafficProvider, settings)
	apiServer.Register(mux)
	apiServer.RegisterAdmin(mux, settings)
	gateway.New(settings).Register(mux)
	web.Register(mux)

	var handler http.Handler = mux
	if cfg.Auth.Enabled {
		authn, err := auth.New(ctx, cfg.Auth, settings)
		if err != nil {
			slog.Error("인증 초기화 실패", "error", err)
			os.Exit(1)
		}
		authn.Register(mux)
		handler = authn.Middleware(mux)
		slog.Info("인증 활성화",
			"oidc", cfg.Auth.OIDCConfigured(),
			"localUsers", len(cfg.Auth.LocalUsers))
	} else {
		auth.RegisterDisabled(mux)
		slog.Warn("인증이 비활성화되어 있습니다 (AUTH_ENABLED=false)")
	}

	server := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	slog.Info("서버 시작", "addr", cfg.ListenAddr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("서버 종료", "error", err)
		os.Exit(1)
	}
}
