package k8s

import (
	"sort"

	corev1 "k8s.io/api/core/v1"
	netv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/labels"
)

// NodeSummary는 토폴로지 뷰에 표시할 노드 정보다.
type NodeSummary struct {
	Name  string `json:"name"`
	Ready bool   `json:"ready"`
	Roles string `json:"roles"` // control-plane / worker
}

// ServicePort는 서비스가 노출하는 포트다.
type ServicePort struct {
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort"`
	Protocol   string `json:"protocol"`
}

// ServiceSummary는 서비스와 셀렉터로 매칭된 대상 Pod 목록이다.
type ServiceSummary struct {
	Name      string        `json:"name"`
	Namespace string        `json:"namespace"`
	Type      string        `json:"type"`
	ClusterIP string        `json:"clusterIP"`
	Ports     []ServicePort `json:"ports"`
	PodKeys   []string      `json:"podKeys"` // "namespace/name" 형태
}

// IngressSummary는 Ingress와 그 백엔드 서비스 연결이다.
type IngressSummary struct {
	Name      string   `json:"name"`
	Namespace string   `json:"namespace"`
	Hosts     []string `json:"hosts"`
	SvcKeys   []string `json:"svcKeys"` // "namespace/name" 형태
}

// Topology는 토폴로지 뷰 렌더링에 필요한 전체 스냅샷이다.
type Topology struct {
	Nodes     []NodeSummary    `json:"nodes"`
	Pods      []PodSummary     `json:"pods"`
	Services  []ServiceSummary `json:"services"`
	Ingresses []IngressSummary `json:"ingresses"`
}

// Topology는 캐시에서 노드·Pod·서비스(셀렉터 매칭 포함)를 모아 반환한다.
func (h *Hub) Topology(namespace string) (*Topology, error) {
	pods, err := h.Pods(namespace)
	if err != nil {
		return nil, err
	}

	nodes, err := h.nodLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	nodeSummaries := make([]NodeSummary, 0, len(nodes))
	for _, n := range nodes {
		nodeSummaries = append(nodeSummaries, summarizeNode(n))
	}
	sort.Slice(nodeSummaries, func(i, j int) bool { return nodeSummaries[i].Name < nodeSummaries[j].Name })

	var services []*corev1.Service
	if namespace == "" {
		services, err = h.svcLister.List(labels.Everything())
	} else {
		services, err = h.svcLister.Services(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}

	svcSummaries := make([]ServiceSummary, 0, len(services))
	for _, svc := range services {
		s := ServiceSummary{
			Name:      svc.Name,
			Namespace: svc.Namespace,
			Type:      string(svc.Spec.Type),
			ClusterIP: svc.Spec.ClusterIP,
			PodKeys:   []string{},
		}
		for _, p := range svc.Spec.Ports {
			s.Ports = append(s.Ports, ServicePort{
				Port:       p.Port,
				TargetPort: p.TargetPort.String(),
				Protocol:   string(p.Protocol),
			})
		}
		// 셀렉터가 있는 서비스만 Pod와 연결한다 (headless/ExternalName 등은 제외될 수 있음)
		if len(svc.Spec.Selector) > 0 {
			selector := labels.SelectorFromSet(svc.Spec.Selector)
			for _, pod := range pods {
				if pod.Namespace == svc.Namespace && selector.Matches(labels.Set(pod.Labels)) {
					s.PodKeys = append(s.PodKeys, pod.Namespace+"/"+pod.Name)
				}
			}
		}
		svcSummaries = append(svcSummaries, s)
	}
	sort.Slice(svcSummaries, func(i, j int) bool {
		if svcSummaries[i].Namespace != svcSummaries[j].Namespace {
			return svcSummaries[i].Namespace < svcSummaries[j].Namespace
		}
		return svcSummaries[i].Name < svcSummaries[j].Name
	})

	ingSummaries, err := h.ingresses(namespace)
	if err != nil {
		return nil, err
	}

	return &Topology{Nodes: nodeSummaries, Pods: pods, Services: svcSummaries, Ingresses: ingSummaries}, nil
}

// ingresses는 Ingress 규칙에서 백엔드 서비스 참조를 추출한다.
func (h *Hub) ingresses(namespace string) ([]IngressSummary, error) {
	var (
		items []*netv1.Ingress
		err   error
	)
	if namespace == "" {
		items, err = h.ingLister.List(labels.Everything())
	} else {
		items, err = h.ingLister.Ingresses(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}

	out := make([]IngressSummary, 0, len(items))
	for _, ing := range items {
		s := IngressSummary{Name: ing.Name, Namespace: ing.Namespace, Hosts: []string{}, SvcKeys: []string{}}
		seen := map[string]bool{}
		addSvc := func(b *netv1.IngressServiceBackend) {
			if b == nil {
				return
			}
			key := ing.Namespace + "/" + b.Name
			if !seen[key] {
				seen[key] = true
				s.SvcKeys = append(s.SvcKeys, key)
			}
		}
		if ing.Spec.DefaultBackend != nil {
			addSvc(ing.Spec.DefaultBackend.Service)
		}
		for _, rule := range ing.Spec.Rules {
			if rule.Host != "" {
				s.Hosts = append(s.Hosts, rule.Host)
			}
			if rule.HTTP == nil {
				continue
			}
			for _, path := range rule.HTTP.Paths {
				addSvc(path.Backend.Service)
			}
		}
		out = append(out, s)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

func summarizeNode(n *corev1.Node) NodeSummary {
	s := NodeSummary{Name: n.Name, Roles: "worker"}
	for _, cond := range n.Status.Conditions {
		if cond.Type == corev1.NodeReady {
			s.Ready = cond.Status == corev1.ConditionTrue
		}
	}
	if _, ok := n.Labels["node-role.kubernetes.io/control-plane"]; ok {
		s.Roles = "control-plane"
	}
	return s
}
