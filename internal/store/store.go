// Package store는 관리자가 웹에서 변경하는 런타임 설정(클러스터 목록, 사용자 계정)을
// 영속화한다. 토큰과 비밀번호 해시가 포함되므로 클러스터 안에서는 Secret에,
// 클러스터 밖(로컬 개발)에서는 파일에 저장한다.
package store

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// Cluster는 게이트웨이가 중계할 원격 podview 인스턴스다.
type Cluster struct {
	Name  string `json:"name"`  // 관리자가 정한 표시 이름 (예: "1번서버")
	URL   string `json:"url"`   // 원격 podview 주소 (예: https://podview.net2.internal)
	Token string `json:"token"` // 원격 인스턴스의 GATEWAY_TOKEN
}

// User는 웹에서 관리되는 로컬 계정이다.
type User struct {
	Username string `json:"username"`
	Hash     string `json:"hash"` // bcrypt
	Role     string `json:"role"` // "admin" | "viewer"
}

// OIDCUser는 SSO(Keycloak) 사용자에게 부여할 역할이다 (이메일로 매칭).
// 사용자는 SSO 로그인 시점에 존재하므로, 이메일로 미리 역할을 지정해 둔다.
type OIDCUser struct {
	Email string `json:"email"`
	Role  string `json:"role"` // "admin" | "viewer"
}

// AIModel은 Pod AI 분석에 사용할 LLM 엔드포인트 하나다. 여러 개 등록 가능.
type AIModel struct {
	Name     string `json:"name"`     // 관리자가 정한 표시 이름 (고유 키)
	Provider string `json:"provider"` // "openai"(vLLM/Ollama 등 호환 API) | "anthropic"
	URL      string `json:"url"`      // 베이스 URL (예: http://vllm.ai-infra:8000)
	Model    string `json:"model"`    // 서빙 모델 이름
	APIKey   string `json:"apiKey"`   // 선택 (사내 서빙은 보통 불필요)
}

// Configured는 이 모델로 분석을 실행할 수 있는 상태인지 여부다.
func (a AIModel) Configured() bool { return a.URL != "" && a.Model != "" }

// legacyAI는 단일 모델이던 구버전 설정의 마이그레이션용이다.
type legacyAI struct {
	Provider string `json:"provider"`
	URL      string `json:"url"`
	Model    string `json:"model"`
	APIKey   string `json:"apiKey"`
}

// Settings는 저장소에 영속화되는 전체 설정이다.
type Settings struct {
	Clusters  []Cluster  `json:"clusters"`
	Users     []User     `json:"users"`
	OIDCUsers []OIDCUser `json:"oidcUsers"`
	AIModels  []AIModel  `json:"aiModels"`
	ActiveAI  string     `json:"activeAI"` // 기본으로 사용할 AIModel의 Name

	LegacyAI *legacyAI `json:"ai,omitempty"` // 구버전 필드 (로드 시 AIModels로 이관)
}

// OIDCRole은 이메일에 지정된 SSO 역할을 반환한다 (없으면 "", false).
func (s Settings) OIDCRole(email string) (string, bool) {
	for _, u := range s.OIDCUsers {
		if u.Email == email {
			return u.Role, true
		}
	}
	return "", false
}

// migrate는 구버전 설정을 새 구조로 옮긴다.
func (s *Settings) migrate() {
	if s.LegacyAI != nil && s.LegacyAI.URL != "" && len(s.AIModels) == 0 {
		name := s.LegacyAI.Model
		if name == "" {
			name = "default"
		}
		s.AIModels = append(s.AIModels, AIModel{
			Name:     name,
			Provider: s.LegacyAI.Provider,
			URL:      s.LegacyAI.URL,
			Model:    s.LegacyAI.Model,
			APIKey:   s.LegacyAI.APIKey,
		})
		s.ActiveAI = name
	}
	s.LegacyAI = nil
}

// ActiveModel은 기본 모델을 반환한다 (지정이 없거나 삭제됐으면 첫 번째).
func (s Settings) ActiveModel() (AIModel, bool) {
	for _, m := range s.AIModels {
		if m.Name == s.ActiveAI {
			return m, true
		}
	}
	if len(s.AIModels) > 0 {
		return s.AIModels[0], true
	}
	return AIModel{}, false
}

// FindModel은 이름으로 모델을 찾는다.
func (s Settings) FindModel(name string) (AIModel, bool) {
	for _, m := range s.AIModels {
		if m.Name == name {
			return m, true
		}
	}
	return AIModel{}, false
}

// backend는 실제 저장 위치 구현이다.
type backend interface {
	load() (Settings, error)
	save(Settings) error
}

// Manager는 설정을 메모리에 캐시하고 변경 시 저장한다. 동시 접근에 안전하다.
type Manager struct {
	mu      sync.RWMutex
	current Settings
	backend backend
}

// NewManager는 저장소를 초기화한다.
// client가 nil이 아니고 namespace가 있으면 Secret, 아니면 dataDir의 JSON 파일을 쓴다.
func NewManager(client kubernetes.Interface, namespace, dataDir string) (*Manager, error) {
	var b backend
	if client != nil && namespace != "" {
		b = &secretBackend{client: client, namespace: namespace}
	} else {
		if dataDir == "" {
			dataDir = "data"
		}
		b = &fileBackend{path: filepath.Join(dataDir, "settings.json")}
	}
	settings, err := b.load()
	if err != nil {
		return nil, fmt.Errorf("설정 로드 실패: %w", err)
	}
	settings.migrate()
	return &Manager{current: settings, backend: b}, nil
}

// Get은 현재 설정의 복사본을 반환한다.
func (m *Manager) Get() Settings {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.current.clone()
}

// Update는 설정을 수정하고 저장한다. fn 안에서 원하는 대로 변경하면 된다.
func (m *Manager) Update(fn func(*Settings) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	next := m.current.clone()
	if err := fn(&next); err != nil {
		return err
	}
	if err := m.backend.save(next); err != nil {
		return fmt.Errorf("설정 저장 실패: %w", err)
	}
	m.current = next
	return nil
}

func (s Settings) clone() Settings {
	out := Settings{
		Clusters:  append([]Cluster{}, s.Clusters...),
		Users:     append([]User{}, s.Users...),
		OIDCUsers: append([]OIDCUser{}, s.OIDCUsers...),
		AIModels:  append([]AIModel{}, s.AIModels...),
		ActiveAI:  s.ActiveAI,
	}
	return out
}

// ── 파일 저장소 ────────────────────────────────────────

type fileBackend struct{ path string }

func (f *fileBackend) load() (Settings, error) {
	var s Settings
	data, err := os.ReadFile(f.path)
	if os.IsNotExist(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	return s, json.Unmarshal(data, &s)
}

func (f *fileBackend) save(s Settings) error {
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(f.path), 0o700); err != nil {
		return err
	}
	return os.WriteFile(f.path, data, 0o600)
}

// ── Secret 저장소 ──────────────────────────────────────

const secretName = "podview-settings"

type secretBackend struct {
	client    kubernetes.Interface
	namespace string
}

func (k *secretBackend) load() (Settings, error) {
	var s Settings
	sec, err := k.client.CoreV1().Secrets(k.namespace).Get(context.Background(), secretName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	data, ok := sec.Data["settings.json"]
	if !ok || len(data) == 0 {
		return s, nil
	}
	return s, json.Unmarshal(data, &s)
}

func (k *secretBackend) save(s Settings) error {
	data, err := json.Marshal(s)
	if err != nil {
		return err
	}
	sec := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: secretName, Namespace: k.namespace},
		Data:       map[string][]byte{"settings.json": data},
	}
	ctx := context.Background()
	_, err = k.client.CoreV1().Secrets(k.namespace).Update(ctx, sec, metav1.UpdateOptions{})
	if apierrors.IsNotFound(err) {
		_, err = k.client.CoreV1().Secrets(k.namespace).Create(ctx, sec, metav1.CreateOptions{})
	}
	return err
}
