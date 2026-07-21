// Package traffic은 Prometheus를 공용 연동 지점으로 삼아 실측 트래픽을 조회한다.
//
// CNI에 종속되지 않는 설계:
//   - Pod별 송수신량: kubelet cAdvisor 메트릭 (모든 CNI에서 동작)
//   - Pod간 플로우:  Hubble(Cilium)·Retina 등 eBPF 도구가 Prometheus로 내보낸 메트릭.
//     기본 쿼리는 Hubble 기준이며, 다른 도구는 TRAFFIC_EDGE_QUERY로 교체한다.
//
// PROMETHEUS_URL이 비어 있으면 전체 기능이 조용히 비활성화된다.
package prom

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// PodRate는 Pod 하나의 초당 송수신 바이트다.
type PodRate struct {
	Namespace  string  `json:"namespace"`
	Name       string  `json:"name"`
	RxBytesSec float64 `json:"rxBytesSec"`
	TxBytesSec float64 `json:"txBytesSec"`
}

// EdgeRate는 Pod간 플로우의 상대적 세기다. 단위는 쿼리에 따라 다르다(기본 flows/s).
type EdgeRate struct {
	FromKey string  `json:"fromKey"` // "namespace/pod"
	ToKey   string  `json:"toKey"`
	Rate    float64 `json:"rate"`
}

type Snapshot struct {
	Available bool      `json:"available"`
	PodRates  []PodRate `json:"podRates"`
	Edges     []EdgeRate `json:"edges"`
	EdgeUnit  string    `json:"edgeUnit"`
}

type Config struct {
	PrometheusURL string // 예: http://prometheus.monitoring:9090
	EdgeQuery     string // 비우면 Hubble 기본 쿼리
	EdgeUnit      string
	GPUUtilQuery  string // 비우면 DCGM 기본 쿼리
	GPUMemQuery   string // 비우면 DCGM 기본 쿼리 (바이트 단위 결과여야 함)
}

const (
	defaultRxQuery = `sum by (namespace, pod) (rate(container_network_receive_bytes_total{pod!=""}[2m]))`
	defaultTxQuery = `sum by (namespace, pod) (rate(container_network_transmit_bytes_total{pod!=""}[2m]))`
	// Hubble 메트릭 기본값. 다음 설정 필요:
	//   hubble.metrics.enabled: flow:sourceContext=namespace|pod;destinationContext=namespace|pod
	defaultEdgeQuery = `sum by (source, destination) (rate(hubble_flows_processed_total{source!="",destination!=""}[2m]))`
)

type Provider struct {
	baseURL      string
	edgeQuery    string
	edgeUnit     string
	gpuUtilQuery string
	gpuMemQuery  string
	client       *http.Client
}

// New는 PrometheusURL이 비어 있으면 nil을 반환한다 (기능 비활성).
func New(cfg Config) *Provider {
	if cfg.PrometheusURL == "" {
		return nil
	}
	p := &Provider{
		baseURL:      cfg.PrometheusURL,
		edgeQuery:    cfg.EdgeQuery,
		edgeUnit:     cfg.EdgeUnit,
		gpuUtilQuery: cfg.GPUUtilQuery,
		gpuMemQuery:  cfg.GPUMemQuery,
		client:       &http.Client{Timeout: 10 * time.Second},
	}
	if p.edgeQuery == "" {
		p.edgeQuery = defaultEdgeQuery
	}
	if p.edgeUnit == "" {
		p.edgeUnit = "flows/s"
	}
	if p.gpuUtilQuery == "" {
		p.gpuUtilQuery = defaultGPUUtilQuery
	}
	if p.gpuMemQuery == "" {
		p.gpuMemQuery = defaultGPUMemQuery
	}
	return p
}

// Snapshot은 네임스페이스(빈 문자열이면 전체)의 트래픽 현황을 조회한다.
// 개별 쿼리 실패는 해당 항목만 비운다 (Hubble 미설치 환경에서 Pod 송수신량만 표시).
func (p *Provider) Snapshot(ctx context.Context, namespace string) Snapshot {
	snap := Snapshot{Available: true, PodRates: []PodRate{}, Edges: []EdgeRate{}, EdgeUnit: p.edgeUnit}

	rx, errRx := p.query(ctx, defaultRxQuery)
	tx, errTx := p.query(ctx, defaultTxQuery)
	if errRx == nil && errTx == nil {
		rates := map[string]*PodRate{}
		for _, s := range rx {
			ns, pod := s.Metric["namespace"], s.Metric["pod"]
			if pod == "" || (namespace != "" && ns != namespace) {
				continue
			}
			rates[ns+"/"+pod] = &PodRate{Namespace: ns, Name: pod, RxBytesSec: s.Value}
		}
		for _, s := range tx {
			ns, pod := s.Metric["namespace"], s.Metric["pod"]
			if pod == "" || (namespace != "" && ns != namespace) {
				continue
			}
			if r, ok := rates[ns+"/"+pod]; ok {
				r.TxBytesSec = s.Value
			} else {
				rates[ns+"/"+pod] = &PodRate{Namespace: ns, Name: pod, TxBytesSec: s.Value}
			}
		}
		for _, r := range rates {
			snap.PodRates = append(snap.PodRates, *r)
		}
	}

	// Pod간 플로우: source/destination 레이블이 "namespace/pod" 형태라고 가정
	if edges, err := p.query(ctx, p.edgeQuery); err == nil {
		for _, s := range edges {
			from, to := s.Metric["source"], s.Metric["destination"]
			if from == "" || to == "" {
				continue
			}
			if namespace != "" && !hasNamespace(from, namespace) && !hasNamespace(to, namespace) {
				continue
			}
			snap.Edges = append(snap.Edges, EdgeRate{FromKey: from, ToKey: to, Rate: s.Value})
		}
	}
	return snap
}

func hasNamespace(key, namespace string) bool {
	return len(key) > len(namespace) && key[:len(namespace)] == namespace && key[len(namespace)] == '/'
}

// ── Prometheus HTTP API ────────────────────────────────

type sample struct {
	Metric map[string]string
	Value  float64
}

func (p *Provider) query(ctx context.Context, promql string) ([]sample, error) {
	u := fmt.Sprintf("%s/api/v1/query?query=%s", p.baseURL, url.QueryEscape(promql))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	res, err := p.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("prometheus 응답 %d", res.StatusCode)
	}

	var body struct {
		Status string `json:"status"`
		Data   struct {
			Result []struct {
				Metric map[string]string `json:"metric"`
				Value  [2]any            `json:"value"` // [timestamp, "값"]
			} `json:"result"`
		} `json:"data"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Status != "success" {
		return nil, fmt.Errorf("prometheus 쿼리 실패: %s", body.Status)
	}

	out := make([]sample, 0, len(body.Data.Result))
	for _, r := range body.Data.Result {
		str, ok := r.Value[1].(string)
		if !ok {
			continue
		}
		v, err := strconv.ParseFloat(str, 64)
		if err != nil {
			continue
		}
		out = append(out, sample{Metric: r.Metric, Value: v})
	}
	return out, nil
}
