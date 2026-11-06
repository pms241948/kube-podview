package auth

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/pms241948/kube-podview/internal/config"
	"github.com/pms241948/kube-podview/internal/i18n"
)

// oidcProvider는 Keycloak 연동 상태를 담는다.
type oidcProvider struct {
	verifier    *oidc.IDTokenVerifier
	oauthConfig oauth2.Config
}

func newOIDCProvider(ctx context.Context, cfg config.AuthConfig) (*oidcProvider, error) {
	provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC 프로바이더 조회 실패 (issuer=%s): %w", cfg.IssuerURL, err)
	}
	return &oidcProvider{
		verifier: provider.Verifier(&oidc.Config{ClientID: cfg.ClientID}),
		oauthConfig: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			Endpoint:     provider.Endpoint(),
			RedirectURL:  cfg.RedirectURL,
			Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
		},
	}, nil
}

func (a *Auth) handleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	state := randomHex(16)
	http.SetCookie(w, &http.Cookie{
		Name: stateCookie, Value: state, Path: "/",
		MaxAge: 300, HttpOnly: true, Secure: a.cookieSecure, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, a.oidc.oauthConfig.AuthCodeURL(state), http.StatusFound)
}

func (a *Auth) handleOIDCCallback(w http.ResponseWriter, r *http.Request) {
	stateC, err := r.Cookie(stateCookie)
	if err != nil || r.URL.Query().Get("state") != stateC.Value {
		// 브라우저 이동으로 오는 요청이라 브라우저 자체의 Accept-Language가 기준이 된다
		http.Error(w, i18n.T(r, "State mismatch", "state 불일치"), http.StatusBadRequest)
		return
	}
	token, err := a.oidc.oauthConfig.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		http.Error(w, i18n.T(r, "Token exchange failed", "토큰 교환 실패"), http.StatusBadGateway)
		return
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		http.Error(w, i18n.T(r, "No id_token in response", "id_token 없음"), http.StatusBadGateway)
		return
	}
	idToken, err := a.oidc.verifier.Verify(r.Context(), rawIDToken)
	if err != nil {
		http.Error(w, i18n.T(r, "ID token verification failed", "ID 토큰 검증 실패"), http.StatusUnauthorized)
		return
	}

	var claims struct {
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	_ = idToken.Claims(&claims)

	// 역할 결정 우선순위:
	//  1) 환경변수 OIDC_ADMIN_EMAILS (배포 시 지정한 부트스트랩 admin — UI에서 강등 불가)
	//  2) 웹 관리자 설정의 SSO 사용자 역할 (이메일 매칭)
	//  3) 기본값 viewer
	role := "viewer"
	if r, ok := a.settings.Get().OIDCRole(claims.Email); ok {
		role = r
	}
	if a.oidcAdmins[claims.Email] {
		role = "admin"
	}
	a.setSession(w, session{
		Subject: idToken.Subject,
		Email:   claims.Email,
		Name:    claims.Name,
		Method:  "oidc",
		Role:    role,
		Expiry:  time.Now().Add(sessionTTL),
	})
	http.SetCookie(w, &http.Cookie{Name: stateCookie, Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/", http.StatusFound)
}

func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
