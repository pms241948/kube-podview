import { useEffect, useMemo, useState } from 'react'
import { fetchClusters, fetchMe, fetchNamespaces, fetchTopology, fetchTraffic } from './lib/api'
import type { IngressSummary, NodeSummary, PodSummary, ServiceSummary, TrafficSnapshot, UserInfo } from './lib/types'
import { isProblemPod } from './lib/format'
import { usePodStream } from './hooks/usePodStream'
import { useMetrics } from './hooks/useMetrics'
import { useGPU } from './hooks/useGPU'
import { useProblemCounts } from './hooks/useProblemCounts'
import { Sidebar } from './components/Sidebar'
import { PodCard } from './components/PodCard'
import { PodDetail } from './components/PodDetail'
import { TopologyView } from './components/TopologyView'
import { LoginPage } from './components/LoginPage'
import { AdminPage } from './components/AdminPage'

type ViewMode = 'cards' | 'topology'

export default function App() {
  // /login 경로는 로그인 페이지를 렌더링 (별도 라우터 없이 처리)
  if (window.location.pathname === '/login') return <LoginPage />
  return <Dashboard />
}

function Dashboard() {
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNS, setSelectedNS] = useState('')
  const [selectedPod, setSelectedPod] = useState<PodSummary | null>(null)
  const [filter, setFilter] = useState('')
  const [view, setView] = useState<ViewMode>('cards')
  const [user, setUser] = useState<UserInfo>({ authenticated: false })
  const [services, setServices] = useState<ServiceSummary[]>([])
  const [nodes, setNodes] = useState<NodeSummary[]>([])
  const [ingresses, setIngresses] = useState<IngressSummary[]>([])
  const [traffic, setTraffic] = useState<TrafficSnapshot | null>(null)
  const [clusters, setClusters] = useState<string[]>([])
  const [cluster, setCluster] = useState('') // '' = 이 인스턴스의 클러스터
  const [showAdmin, setShowAdmin] = useState(false)
  const [problemsOnly, setProblemsOnly] = useState(false)
  const [hoverNS, setHoverNS] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('podview-sidebar-collapsed') === '1',
  )

  const toggleSidebar = () =>
    setSidebarCollapsed((v) => {
      localStorage.setItem('podview-sidebar-collapsed', v ? '0' : '1')
      return !v
    })

  const { pods, connState } = usePodStream(selectedNS, cluster)
  const { usage, metricsAvailable } = useMetrics(selectedNS, cluster)
  const { gpuUsage } = useGPU(selectedNS, cluster)
  const problemCounts = useProblemCounts(cluster)

  const reloadClusters = () => fetchClusters().then((r) => setClusters(r.clusters)).catch(() => {})

  useEffect(() => {
    // 미인증이면 로그인 페이지로 (인증 비활성화 시 authenticated:true 반환)
    fetchMe().then((me) => {
      if (!me.authenticated) window.location.href = '/login'
      else setUser(me)
    })
    reloadClusters()
  }, [])

  // 클러스터 전환 시 네임스페이스 목록을 다시 받고 선택 초기화
  useEffect(() => {
    setSelectedNS('')
    setSelectedPod(null)
    setNamespaces([])
    fetchNamespaces(cluster).then((r) => setNamespaces(r.namespaces)).catch(() => {})
  }, [cluster])

  // 토폴로지 구조(서비스·노드·Ingress)는 자주 안 바뀌므로 30초마다 갱신. Pod 상태는 SSE가 실시간 반영.
  useEffect(() => {
    if (view !== 'topology') return
    let stopped = false
    const load = () =>
      fetchTopology(selectedNS, cluster)
        .then((t) => {
          if (stopped) return
          setServices(t.services)
          setNodes(t.nodes)
          setIngresses(t.ingresses ?? [])
        })
        .catch(() => {})
    load()
    const timer = setInterval(load, 30_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [view, selectedNS, cluster])

  // 실측 트래픽 (Prometheus 미연동 시 available:false 한 번만 확인하고 중단)
  useEffect(() => {
    if (view !== 'topology') return
    let stopped = false
    let timer: ReturnType<typeof setInterval> | undefined
    const load = () =>
      fetchTraffic(selectedNS, cluster)
        .then((t) => {
          if (stopped) return
          setTraffic(t)
          if (!t.available && timer) clearInterval(timer)
        })
        .catch(() => {})
    load()
    timer = setInterval(load, 15_000)
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
    }
  }, [view, selectedNS, cluster])

  const livePod = useMemo(() => {
    if (!selectedPod) return null
    return pods.find((p) => p.namespace === selectedPod.namespace && p.name === selectedPod.name) ?? selectedPod
  }, [pods, selectedPod])

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    let out = pods
    if (f) out = out.filter((p) => p.name.toLowerCase().includes(f) || p.status.toLowerCase().includes(f))
    if (problemsOnly) {
      // 문제 Pod만, 최근 발생 순으로 정렬 (새 장애가 맨 위)
      out = out
        .filter(isProblemPod)
        .slice()
        .sort((a, b) => new Date(b.problemSince!).getTime() - new Date(a.problemSince!).getTime())
    }
    return out
  }, [pods, filter, problemsOnly])

  const counts = useMemo(() => {
    const c = { total: pods.length, running: 0, problem: 0 }
    for (const p of pods) {
      if (isProblemPod(p)) c.problem++
      else c.running++
    }
    return c
  }, [pods])

  return (
    <div className="layout">
      <Sidebar
        namespaces={namespaces}
        selected={selectedNS}
        collapsed={sidebarCollapsed}
        problemCounts={problemCounts}
        highlightNS={hoverNS}
        onToggle={toggleSidebar}
        onSelect={(ns) => {
          setSelectedNS(ns)
          setSelectedPod(null)
        }}
      />
      <div className="main">
        <header className="topbar">
          <div>
            <h1>{selectedNS || '전체 네임스페이스'}</h1>
            <span className="counts">
              총 {counts.total}개 · 정상 {counts.running} ·{' '}
              <button
                className={`problem-filter ${counts.problem > 0 ? 'has-problem' : ''} ${problemsOnly ? 'active' : ''}`}
                onClick={() => setProblemsOnly((v) => !v)}
                title="문제 Pod만 보기 (다시 누르면 해제)"
              >
                이상 {counts.problem}
              </button>
              {problemsOnly && <span className="problem-mode-note"> — 문제 Pod만 표시 중</span>}
            </span>
          </div>
          <div className="topbar-right">
            <select
              className="cluster-select"
              value={cluster}
              onChange={(e) => setCluster(e.target.value)}
              title="클러스터 선택"
            >
              <option value="">이 클러스터</option>
              {clusters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="view-toggle">
              <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}>
                카드
              </button>
              <button className={view === 'topology' ? 'active' : ''} onClick={() => setView('topology')}>
                토폴로지
              </button>
            </div>
            <span className={`conn conn-${connState}`}>
              {connState === 'open' ? '● 실시간 연결됨' : connState === 'connecting' ? '○ 연결 중…' : '○ 재연결 중…'}
            </span>
            {view === 'cards' && (
              <input
                className="filter"
                placeholder="Pod 이름/상태 검색"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            {user.role === 'admin' && (
              <button className="gear" title="관리자 설정" onClick={() => setShowAdmin(true)}>
                ⚙
              </button>
            )}
            {user.authenticated && (user.name || user.email) && (
              <span className="user">
                {user.name || user.email}
                <a href="/auth/logout">로그아웃</a>
              </span>
            )}
          </div>
        </header>

        {!metricsAvailable && (
          <div className="banner">metrics-server가 설치되지 않아 리소스 사용량을 표시할 수 없습니다.</div>
        )}

        {view === 'cards' ? (
          <div className="pod-grid">
            {filtered.map((pod) => (
              <PodCard
                key={`${pod.namespace}/${pod.name}`}
                pod={pod}
                usage={usage.get(`${pod.namespace}/${pod.name}`)}
                gpu={gpuUsage.get(`${pod.namespace}/${pod.name}`)}
                selected={livePod?.name === pod.name && livePod?.namespace === pod.namespace}
                onClick={() => setSelectedPod(pod)}
              />
            ))}
            {filtered.length === 0 && <div className="empty">표시할 Pod가 없습니다.</div>}
          </div>
        ) : (
          <TopologyView
            pods={pods}
            services={services}
            nodes={nodes}
            ingresses={ingresses}
            usage={usage}
            gpuUsage={gpuUsage}
            traffic={traffic}
            problemsOnly={problemsOnly}
            layoutKey={`${cluster}|${selectedNS}`}
            onHoverNamespace={setHoverNS}
            onSelectPod={setSelectedPod}
            selectedPodKey={livePod ? `${livePod.namespace}/${livePod.name}` : undefined}
          />
        )}
      </div>

      {livePod && (
        <PodDetail
          pod={livePod}
          usage={usage.get(`${livePod.namespace}/${livePod.name}`)}
          gpu={gpuUsage.get(`${livePod.namespace}/${livePod.name}`)}
          cluster={cluster}
          onClose={() => setSelectedPod(null)}
        />
      )}

      {showAdmin && <AdminPage onClose={() => setShowAdmin(false)} onClustersChanged={reloadClusters} />}
    </div>
  )
}
