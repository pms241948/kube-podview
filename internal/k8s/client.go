package k8s

import (
	"fmt"
	"os"
	"path/filepath"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	metricsclient "k8s.io/metrics/pkg/client/clientset/versioned"
)

// Clients는 쿠버네티스 API 접근에 필요한 클라이언트 묶음이다.
type Clients struct {
	Core    kubernetes.Interface
	Metrics metricsclient.Interface // metrics-server 미설치 시에도 생성은 되고 호출 시 실패
}

// NewClients는 in-cluster 설정을 우선 사용하고, 실패하면 kubeconfig로 대체한다.
func NewClients(kubeconfig string) (*Clients, error) {
	restCfg, err := buildRestConfig(kubeconfig)
	if err != nil {
		return nil, err
	}

	core, err := kubernetes.NewForConfig(restCfg)
	if err != nil {
		return nil, fmt.Errorf("clientset 생성 실패: %w", err)
	}
	metrics, err := metricsclient.NewForConfig(restCfg)
	if err != nil {
		return nil, fmt.Errorf("metrics clientset 생성 실패: %w", err)
	}
	return &Clients{Core: core, Metrics: metrics}, nil
}

func buildRestConfig(kubeconfig string) (*rest.Config, error) {
	if cfg, err := rest.InClusterConfig(); err == nil {
		return cfg, nil
	}
	if kubeconfig == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return nil, fmt.Errorf("홈 디렉토리 확인 실패: %w", err)
		}
		kubeconfig = filepath.Join(home, ".kube", "config")
	}
	cfg, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
	if err != nil {
		return nil, fmt.Errorf("kubeconfig(%s) 로드 실패: %w", kubeconfig, err)
	}
	return cfg, nil
}
