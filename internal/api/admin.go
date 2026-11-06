package api

import (
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"golang.org/x/crypto/bcrypt"

	"github.com/pms241948/kube-podview/internal/i18n"
	"github.com/pms241948/kube-podview/internal/store"
)

// 관리자 API. /api/admin/* 경로는 auth 미들웨어가 admin 역할을 강제한다.

var validName = regexp.MustCompile(`^[a-zA-Z0-9가-힣._-]{1,40}$`)

// RegisterAdmin은 클러스터/사용자 관리와 클러스터 목록 조회를 등록한다.
func (s *Server) RegisterAdmin(mux *http.ServeMux, settings *store.Manager) {
	// 로그인한 모든 사용자: 클러스터 이름 목록 (선택 드롭다운용)
	mux.HandleFunc("GET /api/clusters", func(w http.ResponseWriter, _ *http.Request) {
		names := []string{}
		for _, c := range settings.Get().Clusters {
			names = append(names, c.Name)
		}
		writeJSON(w, map[string]any{"clusters": names})
	})

	// ── 클러스터 관리 ──
	mux.HandleFunc("GET /api/admin/clusters", func(w http.ResponseWriter, _ *http.Request) {
		clusters := []map[string]any{}
		for _, c := range settings.Get().Clusters {
			clusters = append(clusters, map[string]any{
				"name": c.Name, "url": c.URL, "hasToken": c.Token != "",
			})
		}
		writeJSON(w, map[string]any{"clusters": clusters})
	})

	mux.HandleFunc("POST /api/admin/clusters", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name  string `json:"name"`
			URL   string `json:"url"`
			Token string `json:"token"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		req.URL = strings.TrimRight(strings.TrimSpace(req.URL), "/")
		if !validName.MatchString(req.Name) {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "cluster name must be 40 characters or fewer: letters, digits, ._-", "클러스터 이름은 한글/영문/숫자/._- 40자 이내여야 합니다"))
			return
		}
		if !strings.HasPrefix(req.URL, "http://") && !strings.HasPrefix(req.URL, "https://") {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "URL must start with http(s)://", "URL은 http(s)://로 시작해야 합니다"))
			return
		}
		err := settings.Update(func(st *store.Settings) error {
			for i, c := range st.Clusters {
				if c.Name == req.Name { // 같은 이름이면 갱신 (토큰 비우면 기존 유지)
					if req.Token == "" {
						req.Token = c.Token
					}
					st.Clusters[i] = store.Cluster(req)
					return nil
				}
			}
			st.Clusters = append(st.Clusters, store.Cluster(req))
			return nil
		})
		if err != nil {
			httpError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("DELETE /api/admin/clusters/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		err := settings.Update(func(st *store.Settings) error {
			for i, c := range st.Clusters {
				if c.Name == name {
					st.Clusters = append(st.Clusters[:i], st.Clusters[i+1:]...)
					return nil
				}
			}
			return i18n.Errorf(r, "cluster not found: %s", "클러스터를 찾을 수 없습니다: %s", name)
		})
		if err != nil {
			httpError(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	// ── 사용자 관리 ──
	mux.HandleFunc("GET /api/admin/users", func(w http.ResponseWriter, _ *http.Request) {
		users := []map[string]string{}
		for _, u := range settings.Get().Users {
			users = append(users, map[string]string{"username": u.Username, "role": u.Role})
		}
		writeJSON(w, map[string]any{"users": users})
	})

	mux.HandleFunc("POST /api/admin/users", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Role     string `json:"role"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		req.Username = strings.TrimSpace(req.Username)
		if !validName.MatchString(req.Username) {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "username must be 40 characters or fewer: letters, digits, ._-", "사용자명은 한글/영문/숫자/._- 40자 이내여야 합니다"))
			return
		}
		if req.Role != "admin" && req.Role != "viewer" {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "role must be admin or viewer", "role은 admin 또는 viewer여야 합니다"))
			return
		}
		if len(req.Password) > 0 && len(req.Password) < 8 {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "password must be at least 8 characters", "비밀번호는 8자 이상이어야 합니다"))
			return
		}

		err := settings.Update(func(st *store.Settings) error {
			for i, u := range st.Users {
				if u.Username == req.Username { // 기존 사용자: 역할 변경, 비밀번호는 입력 시에만 재설정
					st.Users[i].Role = req.Role
					if req.Password != "" {
						hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
						if err != nil {
							return err
						}
						st.Users[i].Hash = string(hash)
					}
					return nil
				}
			}
			if req.Password == "" {
				return i18n.Errorf(r, "a password is required for a new user", "신규 사용자는 비밀번호가 필요합니다")
			}
			hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
			if err != nil {
				return err
			}
			st.Users = append(st.Users, store.User{Username: req.Username, Hash: string(hash), Role: req.Role})
			return nil
		})
		if err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	// ── SSO(OIDC) 사용자 역할 관리 ──
	mux.HandleFunc("GET /api/admin/oidc-users", func(w http.ResponseWriter, _ *http.Request) {
		users := []map[string]string{}
		for _, u := range settings.Get().OIDCUsers {
			users = append(users, map[string]string{"email": u.Email, "role": u.Role})
		}
		writeJSON(w, map[string]any{"users": users})
	})

	mux.HandleFunc("POST /api/admin/oidc-users", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Email string `json:"email"`
			Role  string `json:"role"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
			httpError(w, http.StatusBadRequest, err)
			return
		}
		req.Email = strings.TrimSpace(strings.ToLower(req.Email))
		if !strings.Contains(req.Email, "@") || len(req.Email) > 254 {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "not a valid email address", "올바른 이메일 형식이 아닙니다"))
			return
		}
		if req.Role != "admin" && req.Role != "viewer" {
			httpError(w, http.StatusBadRequest, i18n.Errorf(r, "role must be admin or viewer", "role은 admin 또는 viewer여야 합니다"))
			return
		}
		err := settings.Update(func(st *store.Settings) error {
			for i, u := range st.OIDCUsers {
				if u.Email == req.Email { // 기존 이메일이면 역할만 변경
					st.OIDCUsers[i].Role = req.Role
					return nil
				}
			}
			st.OIDCUsers = append(st.OIDCUsers, store.OIDCUser{Email: req.Email, Role: req.Role})
			return nil
		})
		if err != nil {
			httpError(w, http.StatusInternalServerError, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	mux.HandleFunc("DELETE /api/admin/oidc-users/{email}", func(w http.ResponseWriter, r *http.Request) {
		email := strings.ToLower(r.PathValue("email"))
		err := settings.Update(func(st *store.Settings) error {
			for i, u := range st.OIDCUsers {
				if u.Email == email {
					st.OIDCUsers = append(st.OIDCUsers[:i], st.OIDCUsers[i+1:]...)
					return nil
				}
			}
			return i18n.Errorf(r, "SSO user not found: %s", "SSO 사용자를 찾을 수 없습니다: %s", email)
		})
		if err != nil {
			httpError(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})

	s.registerAIAdmin(mux)

	mux.HandleFunc("DELETE /api/admin/users/{username}", func(w http.ResponseWriter, r *http.Request) {
		username := r.PathValue("username")
		err := settings.Update(func(st *store.Settings) error {
			for i, u := range st.Users {
				if u.Username == username {
					st.Users = append(st.Users[:i], st.Users[i+1:]...)
					return nil
				}
			}
			return i18n.Errorf(r, "user not found: %s", "사용자를 찾을 수 없습니다: %s", username)
		})
		if err != nil {
			httpError(w, http.StatusNotFound, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	})
}
