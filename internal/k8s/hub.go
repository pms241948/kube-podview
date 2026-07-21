package k8s

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/kubernetes"
	listersv1 "k8s.io/client-go/listers/core/v1"
	listersnetv1 "k8s.io/client-go/listers/networking/v1"
	"k8s.io/client-go/tools/cache"
)

// Event는 SSE로 내려가는 Pod 변경 이벤트다.
type Event struct {
	Type string     `json:"type"` // ADDED / MODIFIED / DELETED
	Pod  PodSummary `json:"pod"`
}

// Hub는 클러스터 전체 Pod 인포머를 유지하면서 구독자에게 변경 이벤트를 중계한다.
type Hub struct {
	factory   informers.SharedInformerFactory
	podLister listersv1.PodLister
	nsLister  listersv1.NamespaceLister
	svcLister listersv1.ServiceLister
	nodLister listersv1.NodeLister
	ingLister listersnetv1.IngressLister

	mu   sync.Mutex
	subs map[chan Event]string // 채널 → 구독 네임스페이스 ("" = 전체)
}

func NewHub(client kubernetes.Interface) *Hub {
	factory := informers.NewSharedInformerFactory(client, 10*time.Minute)
	return &Hub{
		factory:   factory,
		podLister: factory.Core().V1().Pods().Lister(),
		nsLister:  factory.Core().V1().Namespaces().Lister(),
		svcLister: factory.Core().V1().Services().Lister(),
		nodLister: factory.Core().V1().Nodes().Lister(),
		ingLister: factory.Networking().V1().Ingresses().Lister(),
		subs:      map[chan Event]string{},
	}
}

// Start는 인포머를 시작하고 캐시 동기화를 기다린다.
func (h *Hub) Start(ctx context.Context) error {
	podInformer := h.factory.Core().V1().Pods().Informer()
	_, err := podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj any) { h.broadcast("ADDED", obj) },
		UpdateFunc: func(_, obj any) { h.broadcast("MODIFIED", obj) },
		DeleteFunc: func(obj any) { h.broadcast("DELETED", obj) },
	})
	if err != nil {
		return err
	}
	// Namespace/Service/Node/Ingress 인포머도 활성화
	h.factory.Core().V1().Namespaces().Informer()
	h.factory.Core().V1().Services().Informer()
	h.factory.Core().V1().Nodes().Informer()
	h.factory.Networking().V1().Ingresses().Informer()

	h.factory.Start(ctx.Done())
	for typ, ok := range h.factory.WaitForCacheSync(ctx.Done()) {
		if !ok {
			return fmt.Errorf("인포머 캐시 동기화 실패: %v", typ)
		}
	}
	return nil
}

func (h *Hub) broadcast(eventType string, obj any) {
	pod, ok := obj.(*corev1.Pod)
	if !ok {
		// DeletedFinalStateUnknown 처리
		tombstone, ok := obj.(cache.DeletedFinalStateUnknown)
		if !ok {
			return
		}
		pod, ok = tombstone.Obj.(*corev1.Pod)
		if !ok {
			return
		}
	}
	ev := Event{Type: eventType, Pod: Summarize(pod)}

	h.mu.Lock()
	defer h.mu.Unlock()
	for ch, ns := range h.subs {
		if ns != "" && ns != pod.Namespace {
			continue
		}
		select {
		case ch <- ev:
		default: // 느린 구독자는 이벤트를 건너뛴다 (다음 폴링/재접속에서 복구)
		}
	}
}

// Subscribe는 네임스페이스(빈 문자열이면 전체)의 이벤트 채널을 반환한다.
func (h *Hub) Subscribe(namespace string) (ch chan Event, cancel func()) {
	ch = make(chan Event, 64)
	h.mu.Lock()
	h.subs[ch] = namespace
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}
}

// Namespaces는 캐시된 네임스페이스 이름 목록을 반환한다.
func (h *Hub) Namespaces() ([]string, error) {
	nss, err := h.nsLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(nss))
	for _, ns := range nss {
		names = append(names, ns.Name)
	}
	sort.Strings(names)
	return names, nil
}

// Pods는 캐시에서 네임스페이스의 Pod 요약 목록을 반환한다. 빈 문자열이면 전체.
func (h *Hub) Pods(namespace string) ([]PodSummary, error) {
	var (
		pods []*corev1.Pod
		err  error
	)
	if namespace == "" {
		pods, err = h.podLister.List(labels.Everything())
	} else {
		pods, err = h.podLister.Pods(namespace).List(labels.Everything())
	}
	if err != nil {
		return nil, err
	}
	out := make([]PodSummary, 0, len(pods))
	for _, p := range pods {
		out = append(out, Summarize(p))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Namespace != out[j].Namespace {
			return out[i].Namespace < out[j].Namespace
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}
