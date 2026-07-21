package config

import (
	"fmt"
	"os"
	"strings"
)

// AuthConfig는 인증 설정이다. Keycloak(OIDC)과 로컬 ID/PW 중
// 하나 이상을 설정하면 되고, 둘 다 설정하면 로그인 페이지에서 모두 제공된다.
type AuthConfig struct {
	Enabled      bool
	CookieSecret string // 세션 쿠키 서명 키 (32바이트 이상 권장)
	CookieSecure bool   // HTTPS 전용 쿠키 (로컬 http 테스트 시에만 false)

	// Keycloak OIDC
	IssuerURL    string // 예: https://keycloak.example.com/realms/myrealm
	ClientID     string
	ClientSecret string
	RedirectURL  string // 예: https://podview.example.com/auth/callback

	// 로컬 ID/PW 사용자: username → bcrypt 해시 (부트스트랩용, 항상 admin 역할)
	LocalUsers map[string]string

	// admin 역할을 부여할 OIDC 이메일 목록
	OIDCAdminEmails []string

	// 게이트웨이 인스턴스가 이 인스턴스를 호출할 때 쓰는 서비스 토큰
	GatewayToken string
}

// OIDCConfigured는 Keycloak 연동 설정이 채워졌는지 여부다.
func (a AuthConfig) OIDCConfigured() bool { return a.IssuerURL != "" }

// TrafficConfig는 Prometheus 연동(실측 트래픽·GPU) 설정이다.
type TrafficConfig struct {
	PrometheusURL string // 비어 있으면 비활성. 예: http://prometheus.monitoring:9090
	EdgeQuery     string // Pod간 플로우 PromQL (기본: Hubble). source/destination 레이블이 "ns/pod" 형태여야 함
	EdgeUnit      string // 화면 표시 단위 (기본: flows/s)
	GPUUtilQuery  string // GPU 사용률 PromQL (기본: DCGM)
	GPUMemQuery   string // GPU 메모리 PromQL (기본: DCGM, 바이트 단위 결과)
}

type Config struct {
	ListenAddr   string
	Kubeconfig   string // 비어 있으면 in-cluster 설정 사용
	PodNamespace string // in-cluster에서 설정 Secret을 둘 네임스페이스 (Downward API)
	DataDir      string // 클러스터 밖에서 설정 파일을 둘 디렉토리
	Auth         AuthConfig
	Traffic      TrafficConfig
}

func Load() (Config, error) {
	localUsers, err := parseLocalUsers()
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		ListenAddr:   getenv("LISTEN_ADDR", ":8080"),
		Kubeconfig:   os.Getenv("KUBECONFIG"),
		PodNamespace: os.Getenv("POD_NAMESPACE"),
		DataDir:      getenv("DATA_DIR", "data"),
		Auth: AuthConfig{
			Enabled:      getenv("AUTH_ENABLED", "false") == "true",
			CookieSecret: os.Getenv("COOKIE_SECRET"),
			CookieSecure: getenv("COOKIE_SECURE", "true") == "true",
			IssuerURL:    os.Getenv("OIDC_ISSUER_URL"),
			ClientID:     os.Getenv("OIDC_CLIENT_ID"),
			ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"),
			RedirectURL:  os.Getenv("OIDC_REDIRECT_URL"),
			LocalUsers:      localUsers,
			OIDCAdminEmails: splitNonEmpty(os.Getenv("OIDC_ADMIN_EMAILS")),
			GatewayToken:    os.Getenv("GATEWAY_TOKEN"),
		},
		Traffic: TrafficConfig{
			PrometheusURL: os.Getenv("PROMETHEUS_URL"),
			EdgeQuery:     os.Getenv("TRAFFIC_EDGE_QUERY"),
			EdgeUnit:      os.Getenv("TRAFFIC_EDGE_UNIT"),
			GPUUtilQuery:  os.Getenv("GPU_UTIL_QUERY"),
			GPUMemQuery:   os.Getenv("GPU_MEM_QUERY"),
		},
	}

	if cfg.Auth.Enabled {
		if cfg.Auth.CookieSecret == "" {
			return cfg, fmt.Errorf("AUTH_ENABLED=true인 경우 COOKIE_SECRET 환경변수가 필요합니다")
		}
		if !cfg.Auth.OIDCConfigured() && len(cfg.Auth.LocalUsers) == 0 && cfg.Auth.GatewayToken == "" {
			return cfg, fmt.Errorf("AUTH_ENABLED=true인 경우 OIDC 설정(OIDC_*), 로컬 사용자(LOCAL_USERS), GATEWAY_TOKEN 중 하나 이상이 필요합니다")
		}
		if cfg.Auth.OIDCConfigured() {
			for name, v := range map[string]string{
				"OIDC_CLIENT_ID":     cfg.Auth.ClientID,
				"OIDC_CLIENT_SECRET": cfg.Auth.ClientSecret,
				"OIDC_REDIRECT_URL":  cfg.Auth.RedirectURL,
			} {
				if v == "" {
					return cfg, fmt.Errorf("OIDC_ISSUER_URL이 설정된 경우 %s 환경변수도 필요합니다", name)
				}
			}
		}
	}
	return cfg, nil
}

// parseLocalUsers는 LOCAL_USERS 환경변수("user1:해시,user2:해시") 또는
// LOCAL_USERS_FILE(줄마다 "user:해시", # 주석 허용)에서 사용자 목록을 읽는다.
// bcrypt 해시 생성: go run ./cmd/hashpw
func parseLocalUsers() (map[string]string, error) {
	users := map[string]string{}

	addLine := func(line, from string) error {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			return nil
		}
		name, hash, found := strings.Cut(line, ":")
		if !found || name == "" || !strings.HasPrefix(hash, "$2") {
			return fmt.Errorf("%s의 사용자 항목 형식이 잘못되었습니다 (\"이름:bcrypt해시\" 형식이어야 함): %q", from, line)
		}
		users[name] = hash
		return nil
	}

	if env := os.Getenv("LOCAL_USERS"); env != "" {
		for _, entry := range strings.Split(env, ",") {
			if err := addLine(entry, "LOCAL_USERS"); err != nil {
				return nil, err
			}
		}
	}
	if file := os.Getenv("LOCAL_USERS_FILE"); file != "" {
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, fmt.Errorf("LOCAL_USERS_FILE 읽기 실패: %w", err)
		}
		for _, line := range strings.Split(string(data), "\n") {
			if err := addLine(line, "LOCAL_USERS_FILE"); err != nil {
				return nil, err
			}
		}
	}
	return users, nil
}

func splitNonEmpty(s string) []string {
	var out []string
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
