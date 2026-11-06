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
import {
  EMPTY_MESSAGE,
  NamespaceCard,
  NamespaceFilterBar,
  filterNamespaces,
  summarizeNamespaces,
  type NsFilter,
} from './components/NamespaceCard'
import { PodDetail } from './components/PodDetail'
import { TopologyView } from './components/TopologyView'
import { LoginPage } from './components/LoginPage'
import { AdminPage } from './components/AdminPage'
import { useI18n } from './lib/i18n'

// 화면 설정은 브라우저에 저장한다. 저장소가 막힌 환경(사생활 보호 모드 등)에서도 화면은 정상 동작해야 하므로 예외는 무시.
function loadPref(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 저장 실패는 무시 — 다음 방문 시 기본값으로 시작 */
  }
}

const NS_FILTERS: NsFilter[] = ['all', 'problem', 'recent']

export default function App() {
  // /login 경로는 로그인 페이지를 렌더링 (별도 라우터 없이 처리)
  if (window.location.pathname === '/login') return <LoginPage />
  return <Dashboard />
}

function Dashboard() {
  const { t } = useI18n()
  const [namespaces, setNamespaces] = useState<string[]>([])
  const [selectedNS, setSelectedNS] = useState('')
  const [selectedPod, setSelectedPod] = useState<PodSummary | null>(null)
  const [filter, setFilter] = useState('')
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
  const [nsFilter, setNsFilter] = useState<NsFilter>(() => {
    const saved = loadPref('podview-ns-filter') as NsFilter | null
    return saved && NS_FILTERS.includes(saved) ? saved : 'all'
  })
  const [hideEmptyNS, setHideEmptyNS] = useState(() => loadPref('podview-ns-hide-empty') === '1')
  const changeNsFilter = (f: NsFilter) => {
    setNsFilter(f)
    savePref('podview-ns-filter', f)
  }
  const changeHideEmptyNS = (v: boolean) => {
    setHideEmptyNS(v)
    savePref('podview-ns-hide-empty', v ? '1' : '0')
  }
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

  // 전체 네임스페이스는 요약 카드(개요), 네임스페이스를 고르면 그 네임스페이스의 토폴로지를 보여준다.
  // 클러스터 전체를 토폴로지로 그리면 Pod가 너무 많아 읽기 어렵기 때문이다.
  const isOverview = selectedNS === ''

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
    // 네임스페이스가 바뀌면 이전 네임스페이스의 구조가 잠깐 보이지 않도록 비운다
    setServices([])
    setNodes([])
    setIngresses([])
    if (isOverview) return
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
  }, [isOverview, selectedNS, cluster])

  // 실측 트래픽 (Prometheus 미연동 시 available:false 한 번만 확인하고 중단)
  useEffect(() => {
    setTraffic(null)
    if (isOverview) return
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
  }, [isOverview, selectedNS, cluster])

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

  // 개요 화면에서 "이상 N"을 누르거나 검색하면 네임스페이스 카드 대신
  // 클러스터 전체에서 해당하는 Pod 카드를 보여준다 (문제 Pod는 최근 발생순).
  const showPodList = isOverview && (problemsOnly || filter.trim() !== '')

  const nsSummaries = useMemo(
    () => (isOverview ? summarizeNamespaces(namespaces, pods, usage) : []),
    [isOverview, namespaces, pods, usage],
  )
  const visibleNS = useMemo(
    () => filterNamespaces(nsSummaries, nsFilter, hideEmptyNS),
    [nsSummaries, nsFilter, hideEmptyNS],
  )

  const selectNamespace = (ns: string) => {
    setSelectedNS(ns)
    setSelectedPod(null)
    setHoverNS(null)
  }

  return (
    <div className="layout">
      <Sidebar
        namespaces={namespaces}
        selected={selectedNS}
        collapsed={sidebarCollapsed}
        problemCounts={problemCounts}
        highlightNS={hoverNS}
        onToggle={toggleSidebar}
        onSelect={selectNamespace}
      />
      <div className="main">
        <header className="topbar">
          <div>
            <h1>{selectedNS || t('app.allNamespaces')}</h1>
            <span className="counts">
              {t('app.counts', { total: counts.total, ok: counts.running })}
              <button
                className={`problem-filter ${counts.problem > 0 ? 'has-problem' : ''} ${problemsOnly ? 'active' : ''}`}
                onClick={() => setProblemsOnly((v) => !v)}
                title={t('app.problemBtnTitle')}
              >
                {t('app.problemBtn', { n: counts.problem })}
              </button>
              {problemsOnly && (
                <span className="problem-mode-note">
                  {t(isOverview ? 'app.problemModeOverview' : 'app.problemModeTopology')}
                </span>
              )}
            </span>
          </div>
          <div className="topbar-right">
            <select
              className="cluster-select"
              value={cluster}
              onChange={(e) => setCluster(e.target.value)}
              title={t('app.clusterSelect')}
            >
              <option value="">{t('app.thisCluster')}</option>
              {clusters.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className={`conn conn-${connState}`}>
              {t(connState === 'open' ? 'app.connOpen' : connState === 'connecting' ? 'app.connConnecting' : 'app.connRetry')}
            </span>
            <input
              className="filter"
              placeholder={t(isOverview ? 'app.searchOverview' : 'app.searchTopology')}
              title={t(isOverview ? 'app.searchOverviewTitle' : 'app.searchTopologyTitle')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {/* 설정은 모든 사용자에게 열려 있다 (언어 등 일반 설정). 관리자 항목은 설정 화면 안에서 admin에게만 보인다 */}
            <button className="gear" title={t('app.settings')} onClick={() => setShowAdmin(true)}>
              ⚙
            </button>
            {user.authenticated && (user.name || user.email) && (
              <span className="user">
                {user.name || user.email}
                <a href="/auth/logout">{t('app.logout')}</a>
              </span>
            )}
          </div>
        </header>

        {!metricsAvailable && (
          <div className="banner">{t('app.noMetrics')}</div>
        )}

        {/* 네임스페이스 카드 필터 — Pod 카드 목록("이상 N"·검색)일 때는 숨긴다 */}
        {isOverview && !showPodList && (
          <NamespaceFilterBar
            summaries={nsSummaries}
            value={nsFilter}
            hideEmpty={hideEmptyNS}
            onChange={changeNsFilter}
            onHideEmptyChange={changeHideEmptyNS}
          />
        )}

        {isOverview && !showPodList ? (
          <div className="pod-grid">
            {visibleNS.map((s) => (
              <NamespaceCard
                key={s.ns}
                summary={s}
                onOpen={() => selectNamespace(s.ns)}
                onSelectPod={setSelectedPod}
                onHover={setHoverNS}
              />
            ))}
            {visibleNS.length === 0 && <div className="empty">{t(EMPTY_MESSAGE[nsFilter])}</div>}
          </div>
        ) : showPodList ? (
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
            {filtered.length === 0 && <div className="empty">{t('app.noPods')}</div>}
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
            searchQuery={filter}
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

      {showAdmin && (
        <AdminPage isAdmin={user.role === 'admin'} onClose={() => setShowAdmin(false)} onClustersChanged={reloadClusters} />
      )}
    </div>
  )
}
