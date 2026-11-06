// Package auth는 두 가지 로그인 방식을 제공한다.
//
//   - Keycloak(OIDC) 인가 코드 플로우: /auth/login → Keycloak → /auth/callback
//   - 로컬 ID/PW(bcrypt): POST /auth/local
//
// 어느 쪽이든 성공하면 HMAC-SHA256 서명된 세션 쿠키를 발급하고,
// 미들웨어가 이후 요청의 쿠키를 검증한다.
package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/pms241948/CC-K8s-podview/internal/config"
	"github.com/pms241948/CC-K8s-podview/internal/i18n"
	"github.com/pms241948/CC-K8s-podview/internal/store"
)

const (
	sessionCookie = "podview_session"
	stateCookie   = "podview_oauth_state"
	sessionTTL    = 8 * time.Hour
)

type Auth struct {
	oidc         *oidcProvider     // nil이면 OIDC 비활성
	envUsers     map[string]string // LOCAL_USERS 부트스트랩 계정 (항상 admin)
	oidcAdmins   map[string]bool   // admin 역할을 받을 OIDC 이메일
	settings     *store.Manager    // 웹에서 관리되는 계정 (nil 가능)
	serviceToken string            // 게이트웨이 간 인증 토큰 (GATEWAY_TOKEN)
	cookieSecret []byte
	cookieSecure bool

	mu       sync.Mutex
	failures map[string][]time.Time // 로그인 실패 기록 (username 기준 제한)
}

type session struct {
	Subject string    `json:"sub"`
	Email   string    `json:"email,omitempty"`
	Name    string    `json:"name,omitempty"`
	Method  string    `json:"method"` // "oidc" | "local"
	Role    string    `json:"role"`   // "admin" | "viewer"
	Expiry  time.Time `json:"exp"`
}

func New(ctx context.Context, cfg config.AuthConfig, settings *store.Manager) (*Auth, error) {
	a := &Auth{
		envUsers:     cfg.LocalUsers,
		oidcAdmins:   map[string]bool{},
		settings:     settings,
		serviceToken: cfg.GatewayToken,
		cookieSecret: []byte(cfg.CookieSecret),
		cookieSecure: cfg.CookieSecure,
		failures:     map[string][]time.Time{},
	}
	for _, email := range cfg.OIDCAdminEmails {
		a.oidcAdmins[email] = true
	}
	if cfg.OIDCConfigured() {
		p, err := newOIDCProvider(ctx, cfg)
		if err != nil {
			return nil, err
		}
		a.oidc = p
	}
	return a, nil
}

// lookupUser는 저장소 계정을 먼저, 그다음 env 부트스트랩 계정을 찾는다.
func (a *Auth) lookupUser(username string) (hash, role string, ok bool) {
	if a.settings != nil {
		for _, u := range a.settings.Get().Users {
			if u.Username == username {
				return u.Hash, u.Role, true
			}
		}
	}
	if h, exists := a.envUsers[username]; exists {
		return h, "admin", true
	}
	return "", "", false
}

// hasLocalUsers는 로그인 페이지에 ID/PW 폼을 보여줄지 결정한다.
func (a *Auth) hasLocalUsers() bool {
	if len(a.envUsers) > 0 {
		return true
	}
	return a.settings != nil && len(a.settings.Get().Users) > 0
}

func (a *Auth) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/methods", a.handleMethods)
	mux.HandleFunc("POST /auth/local", a.handleLocalLogin)
	mux.HandleFunc("GET /auth/logout", a.handleLogout)
	mux.HandleFunc("GET /auth/me", a.handleMe)
	if a.oidc != nil {
		mux.HandleFunc("GET /auth/login", a.handleOIDCLogin)
		mux.HandleFunc("GET /auth/callback", a.handleOIDCCallback)
	}
}

// RegisterDisabled는 인증 비활성 시에도 프론트엔드가 상태를 알 수 있게 한다.
func RegisterDisabled(mux *http.ServeMux) {
	mux.HandleFunc("GET /auth/methods", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"enabled": false, "oidc": false, "local": false})
	})
	mux.HandleFunc("GET /auth/me", func(w http.ResponseWriter, _ *http.Request) {
		// 인증 비활성 환경에서는 모든 기능(관리자 탭 포함)을 연다.
		writeJSON(w, http.StatusOK, map[string]any{"authenticated": true, "name": "", "role": "admin"})
	})
}

// Middleware는 API(/api/*)와 프록시(/proxy/*) 요청의 인증을 검사한다.
// 정적 자원(SPA 셸)은 공개하고, 데이터는 전부 /api를 통하므로 그쪽만 지키면 된다.
// 게이트웨이에서 온 요청은 GATEWAY_TOKEN Bearer 헤더로 인증한다.
// /api/admin/*은 admin 역할이 필요하다.
func (a *Auth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		protected := (strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/healthz") ||
			strings.HasPrefix(r.URL.Path, "/proxy/")
		if !protected {
			next.ServeHTTP(w, r)
			return
		}

		if a.serviceToken != "" && r.Header.Get("Authorization") == "Bearer "+a.serviceToken {
			// 게이트웨이 서비스 요청: admin API는 허용하지 않는다.
			if strings.HasPrefix(r.URL.Path, "/api/admin/") {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		sess, ok := a.sessionFrom(r)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/admin/") && sess.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": i18n.T(r, "Admin access is required", "관리자 권한이 필요합니다")})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (a *Auth) handleMethods(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled": true,
		"oidc":    a.oidc != nil,
		"local":   a.hasLocalUsers(),
	})
}

// handleLocalLogin은 ID/PW를 bcrypt 해시와 대조한다.
// 무차별 대입 완화: 같은 계정으로 1분 내 5회 실패 시 잠시 차단.
func (a *Auth) handleLocalLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || req.Username == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": i18n.T(r, "Invalid request", "잘못된 요청")})
		return
	}

	if a.tooManyFailures(req.Username) {
		writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": i18n.T(r, "Too many sign-in attempts. Try again in a moment.", "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.")})
		return
	}

	hash, role, exists := a.lookupUser(req.Username)
	if !exists {
		// 존재하지 않는 계정도 동일한 시간이 걸리게 하여 계정 존재 여부 노출 방지
		hash = "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva"
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil || !exists {
		a.recordFailure(req.Username)
		slog.Warn("로컬 로그인 실패", "username", req.Username, "remote", r.RemoteAddr)
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": i18n.T(r, "Incorrect username or password", "아이디 또는 비밀번호가 올바르지 않습니다")})
		return
	}
	if role == "" {
		role = "viewer"
	}

	a.setSession(w, session{
		Subject: req.Username,
		Name:    req.Username,
		Method:  "local",
		Role:    role,
		Expiry:  time.Now().Add(sessionTTL),
	})
	slog.Info("로컬 로그인 성공", "username", req.Username)
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (a *Auth) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/login", http.StatusFound)
}

func (a *Auth) handleMe(w http.ResponseWriter, r *http.Request) {
	sess, ok := a.sessionFrom(r)
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]bool{"authenticated": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated": true,
		"email":         sess.Email,
		"name":          sess.Name,
		"method":        sess.Method,
		"role":          sess.Role,
	})
}

func (a *Auth) tooManyFailures(username string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	cutoff := time.Now().Add(-time.Minute)
	recent := a.failures[username][:0]
	for _, t := range a.failures[username] {
		if t.After(cutoff) {
			recent = append(recent, t)
		}
	}
	a.failures[username] = recent
	return len(recent) >= 5
}

func (a *Auth) recordFailure(username string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.failures[username] = append(a.failures[username], time.Now())
}

// ── 세션 쿠키 ──────────────────────────────────────────

// setSession은 세션을 JSON→base64로 인코딩하고 HMAC-SHA256 서명을 붙여 쿠키에 저장한다.
func (a *Auth) setSession(w http.ResponseWriter, sess session) {
	payload, _ := json.Marshal(sess)
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    encoded + "." + a.sign(encoded),
		Path:     "/",
		MaxAge:   int(sessionTTL.Seconds()),
		HttpOnly: true,
		Secure:   a.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (a *Auth) sessionFrom(r *http.Request) (session, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return session{}, false
	}
	encoded, sig, found := strings.Cut(c.Value, ".")
	if !found || !hmac.Equal([]byte(sig), []byte(a.sign(encoded))) {
		return session{}, false
	}
	payload, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return session{}, false
	}
	var sess session
	if json.Unmarshal(payload, &sess) != nil || time.Now().After(sess.Expiry) {
		return session{}, false
	}
	return sess, true
}

func (a *Auth) sign(data string) string {
	mac := hmac.New(sha256.New, a.cookieSecret)
	mac.Write([]byte(data))
	return hex.EncodeToString(mac.Sum(nil))
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
