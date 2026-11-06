import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/**
 * 화면 언어 (영어 기본). 외부 라이브러리 없이 사전 두 개와 Context로만 구현한다 — 폐쇄망 반입 대상이므로
 * 의존성을 늘리지 않는다. 선택한 언어는 브라우저(localStorage)에 저장되고, API 요청의
 * Accept-Language 헤더로도 전달되어 서버 오류 메시지와 AI 분석 보고서 언어에 반영된다.
 */
export type Lang = 'en' | 'ko'

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
]

const en = {
  // 공통
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.addOrUpdate': 'Add / update',
  'common.saveFailed': 'Save failed',
  'common.loading': 'Loading…',
  'common.checking': 'Checking…',
  'role.admin': 'Admin',
  'role.viewer': 'Viewer',
  'status.error': 'Error',
  'status.warn': 'Pending',
  'status.ok': 'Healthy',
  'status.done': 'Completed',

  // 문제 발생 시점
  'recency.chronic': 'Chronic · {age}',
  'recency.ago': '{age} ago',
  'recency.shortChronic': 'chronic {age}',
  'time.ago': '{age} ago',

  // 상단바·메인
  'app.allNamespaces': 'All namespaces',
  'app.counts': 'Total {total} · Healthy {ok} · ',
  'app.problemBtn': 'Problems {n}',
  'app.problemBtnTitle': 'Show only problem Pods (click again to clear)',
  'app.problemModeOverview': ' — showing all problem Pods, newest first',
  'app.problemModeTopology': ' — dimming everything except problem Pods',
  'app.clusterSelect': 'Select cluster',
  'app.thisCluster': 'This cluster',
  'app.connOpen': '● Live',
  'app.connConnecting': '○ Connecting…',
  'app.connRetry': '○ Reconnecting…',
  'app.searchOverview': 'Search Pod name/status (all)',
  'app.searchTopology': 'Search Pod name/status (highlight)',
  'app.searchOverviewTitle': 'Shows matching Pod cards across all namespaces',
  'app.searchTopologyTitle': 'Highlights matching Pods and dims the rest',
  'app.settings': 'Settings',
  'app.logout': 'Log out',
  'app.noMetrics': "metrics-server isn't installed, so resource usage can't be shown.",
  'app.noPods': 'No Pods to show.',

  // 네임스페이스 카드·필터
  'ns.filterLabel': 'Namespace filter',
  'ns.filter.all': 'All',
  'ns.filter.allTitle': 'All namespaces',
  'ns.filter.problem': 'With problems',
  'ns.filter.problemTitle': 'Namespaces with at least one problem Pod',
  'ns.filter.recent': 'Last 24h',
  'ns.filter.recentTitle': 'Namespaces with a new problem in the last 24 hours (excludes ones with only chronic problems)',
  'ns.empty.all': 'No namespaces to show.',
  'ns.empty.problem': 'No namespaces have problem Pods.',
  'ns.empty.recent': 'No new problems in the last 24 hours.',
  'ns.hideEmpty': 'Hide empty namespaces',
  'ns.openTopology': 'Open {ns} topology',
  'ns.noPods': 'No Pods',
  'ns.podDetails': 'Open {name} details',
  'ns.more': '+{n} more',

  // 사이드바
  'sidebar.expand': 'Expand namespace list',
  'sidebar.collapse': 'Collapse namespace list',
  'sidebar.all': 'All',
  'sidebar.search': 'Search namespaces',
  'sidebar.clear': 'Clear',
  'sidebar.noMatch': 'No matching namespaces',
  'sidebar.resize': 'Drag to resize',

  // Pod 상세
  'detail.tab.info': 'Info',
  'detail.tab.env': 'Environment',
  'detail.tab.logs': 'Logs',
  'detail.tab.events': 'Events',
  'detail.tab.ai': 'AI analysis',
  'detail.status': 'Status',
  'detail.restarts': 'Restarts',
  'detail.node': 'Node',
  'detail.memory': 'Memory',
  'detail.gpuAlloc': 'GPU allocated',
  'detail.gpuUtil': 'GPU utilization',
  'detail.gpuMem': 'GPU memory',
  'detail.containers': 'Containers',
  'detail.labels': 'Labels',
  'detail.envTitle': '{name} — environment variables',
  'detail.noEnv': 'No environment variables',
  'detail.ports': 'Ports: {v}',
  'detail.mounts': 'Mounts: {v}',
  'detail.volumes': 'Volumes',
  'detail.envAll': '(all)',
  'detail.volOther': 'other',
  'detail.noEvents': 'No recent events.',
  'detail.conditions': 'Conditions',

  // AI 분석 탭
  'ai.notConfigured': "AI analysis isn't configured.",
  'ai.notConfiguredHint': 'Register a model endpoint in Settings (⚙) → AI analysis.',
  'ai.running': 'Analyzing… (up to 2 min)',
  'ai.rerun': 'Run again',
  'ai.run': 'Run analysis',
  'ai.waiting': 'Sent the Pod status, events, and recent logs to the model. Waiting for a response…',
  'ai.model': 'Model: {m}',
  'ai.intro':
    "Run analysis collects this Pod's status, conditions, K8s events, and recent logs, and asks the selected AI model for a root-cause analysis. Sensitive data such as environment variable values is never sent.",

  // 로그
  'logs.failed': "Couldn't load logs ({status})",
  'logs.follow': 'Live',
  'logs.loading': 'Loading logs…',

  // 로그인
  'login.failed': 'Sign-in failed',
  'login.username': 'Username',
  'login.password': 'Password',
  'login.busy': 'Signing in…',
  'login.submit': 'Sign in',
  'login.or': 'or',
  'login.sso': 'Sign in with SSO (Keycloak)',

  // API 오류 (서버가 메시지를 주지 않은 경우)
  'api.requestFailed': 'Request failed ({status})',
  'api.analyzeFailed': 'Analysis request failed ({status})',
  'api.loginFailed': 'Sign-in failed ({status})',

  // 토폴로지
  'topo.routing': 'Routing traffic',
  'topo.excluded': 'Excluded from traffic (Not Ready)',
  'topo.cpuRing': 'CPU usage ring',
  'topo.gpuRing': 'GPU utilization ring (0–100%)',
  'topo.flowLegend': 'Measured flow — dot speed = volume',
  'topo.resetLayout': 'Reset layout',
  'topo.noteMeasured': '※ Dot speed and count = measured traffic, faded line = no traffic',
  'topo.noteSelector': '※ Selector-based routing paths, not measured traffic',
  'topo.ingSvc': 'Ingress {ing}\n→ Service {svc}',
  'topo.svcPod': 'Service {svc}\n→ Pod {pod}',
  'topo.notReady': 'Not Ready — excluded from traffic',
  'topo.rxtx': 'In {rx}/s · Out {tx}/s',
  'topo.noTraffic': ' (no traffic)',
  'topo.flow': 'Measured flow\n{from}\n→ {to}',
  'topo.fromTx': 'Source Pod sends {v}/s',
  'topo.toRx': 'Destination Pod receives {v}/s',
  'topo.noHost': '(no host)',
  'topo.dragMove': 'Drag to move',
  'topo.dragResize': 'Drag to resize',
  'topo.podStatus': 'Status: {status} · Ready {ready}',
  'topo.problem': 'Problem: {label}',
  'topo.gpuAlloc': 'GPU allocated: {n}',
  'topo.unassigned': '(unassigned)',

  // 설정
  'settings.title': 'Settings',
  'settings.general': 'General',
  'settings.language': 'Language',
  'settings.languageDesc': 'Saved in this browser. Also applies to server messages and AI analysis reports.',

  // 관리자 설정 — 클러스터
  'admin.cluster.title': 'Clusters',
  'admin.cluster.desc':
    "Register podview instances in other networks to add them to the cluster selector at the top. The token is that instance's {code} value.",
  'admin.name': 'Name',
  'admin.token': 'Token',
  'admin.tokenSet': 'Set',
  'admin.role': 'Role',
  'admin.email': 'Email',
  'admin.cluster.empty': 'No remote clusters registered',
  'admin.cluster.namePh': 'Name (e.g. cluster-2)',
  'admin.cluster.urlPh': 'URL (e.g. https://podview.net2.internal)',
  'admin.cluster.tokenPh': 'GATEWAY_TOKEN (leave blank to keep when editing)',
  'admin.cluster.confirmDelete': 'Remove cluster "{name}"? (The remote cluster itself isn\'t affected.)',

  // 관리자 설정 — 로컬 사용자
  'admin.users.title': 'Users',
  'admin.users.desc':
    "Enter an existing username to change its role or reset its password (the password changes only if you enter one). Bootstrap accounts from the {code} environment variable aren't listed here and are always admins.",
  'admin.users.username': 'Username',
  'admin.users.empty': 'No users added from the web',
  'admin.users.passwordPh': 'Password (8+ characters)',
  'admin.users.confirmDelete': 'Delete user "{name}"?',

  // 관리자 설정 — SSO 사용자
  'admin.oidc.title': 'SSO (Keycloak) user roles',
  'admin.oidc.desc':
    "Assign roles ahead of time by the email of users who sign in with SSO. SSO users without an assigned role sign in as viewers. Accounts in the {code} environment variable are always admins and can't be demoted here (bootstrap).",
  'admin.oidc.empty': 'No SSO users assigned (everyone signs in as a viewer)',
  'admin.oidc.emailPh': 'Email (e.g. user@example.com)',
  'admin.oidc.confirmDelete': 'Remove the role for SSO user "{name}"? (They\'ll sign in as a viewer from their next login.)',

  // 관리자 설정 — AI 모델
  'admin.ai.title': 'AI analysis',
  'admin.ai.desc':
    'LLM endpoints used by the AI analysis tab in Pod details. Register several and pick one per analysis; the default one is preselected. Use {openai} for OpenAI-compatible APIs such as vLLM, Ollama, and LiteLLM, and {anthropic} for the Anthropic Messages API format. Enter only the base URL (e.g. {example}).',
  'admin.ai.provider': 'Format',
  'admin.ai.urlModel': 'URL / model',
  'admin.ai.default': 'Default',
  'admin.ai.makeDefault': 'Make default',
  'admin.ai.keySet': ' · key set',
  'admin.ai.empty': 'No AI models registered',
  'admin.ai.namePh': 'Name (e.g. llm-7b)',
  'admin.ai.openai': 'OpenAI-compatible',
  'admin.ai.anthropic': 'Anthropic-compatible',
  'admin.ai.urlPh': 'Base URL',
  'admin.ai.modelPh': 'Model name',
  'admin.ai.keyPh': 'API key (optional — leave blank to keep when editing)',
  'admin.ai.confirmDelete': 'Remove AI model "{name}"?',
} as const

export type MessageKey = keyof typeof en

// Record<MessageKey, string>이므로 한국어 항목이 하나라도 빠지면 타입 오류가 난다
const ko: Record<MessageKey, string> = {
  'common.delete': '삭제',
  'common.edit': '수정',
  'common.addOrUpdate': '추가 / 수정',
  'common.saveFailed': '저장 실패',
  'common.loading': '불러오는 중…',
  'common.checking': '확인 중…',
  'role.admin': '관리자',
  'role.viewer': '조회자',
  'status.error': '오류',
  'status.warn': '대기',
  'status.ok': '정상',
  'status.done': '완료',

  'recency.chronic': '만성 · {age} 경과',
  'recency.ago': '{age} 전 발생',
  'recency.shortChronic': '만성 {age}',
  'time.ago': '{age} 전',

  'app.allNamespaces': '전체 네임스페이스',
  'app.counts': '총 {total}개 · 정상 {ok} · ',
  'app.problemBtn': '이상 {n}',
  'app.problemBtnTitle': '문제 Pod만 보기 (다시 누르면 해제)',
  'app.problemModeOverview': ' — 전체 문제 Pod를 최근 발생순으로 표시 중',
  'app.problemModeTopology': ' — 문제 Pod 외에는 흐리게 표시 중',
  'app.clusterSelect': '클러스터 선택',
  'app.thisCluster': '이 클러스터',
  'app.connOpen': '● 실시간 연결됨',
  'app.connConnecting': '○ 연결 중…',
  'app.connRetry': '○ 재연결 중…',
  'app.searchOverview': 'Pod 이름/상태 검색 (전체)',
  'app.searchTopology': 'Pod 이름/상태 검색 (강조)',
  'app.searchOverviewTitle': '전체 네임스페이스에서 일치하는 Pod 카드를 보여줍니다',
  'app.searchTopologyTitle': '일치하는 Pod만 강조하고 나머지는 흐리게 표시합니다',
  'app.settings': '설정',
  'app.logout': '로그아웃',
  'app.noMetrics': 'metrics-server가 설치되지 않아 리소스 사용량을 표시할 수 없습니다.',
  'app.noPods': '표시할 Pod가 없습니다.',

  'ns.filterLabel': '네임스페이스 필터',
  'ns.filter.all': '전체',
  'ns.filter.allTitle': '모든 네임스페이스',
  'ns.filter.problem': '문제 있음',
  'ns.filter.problemTitle': '문제 Pod가 1개 이상인 네임스페이스',
  'ns.filter.recent': '최근 24시간',
  'ns.filter.recentTitle': '24시간 이내에 새 문제가 생긴 네임스페이스 (만성 문제만 있는 곳은 제외)',
  'ns.empty.all': '표시할 네임스페이스가 없습니다.',
  'ns.empty.problem': '문제 Pod가 있는 네임스페이스가 없습니다.',
  'ns.empty.recent': '최근 24시간 안에 새로 생긴 문제가 없습니다.',
  'ns.hideEmpty': '빈 네임스페이스 숨기기',
  'ns.openTopology': '{ns} 토폴로지 보기',
  'ns.noPods': 'Pod 없음',
  'ns.podDetails': '{name} 상세 보기',
  'ns.more': '외 {n}개',

  'sidebar.expand': '네임스페이스 목록 펼치기',
  'sidebar.collapse': '네임스페이스 목록 접기',
  'sidebar.all': '전체',
  'sidebar.search': '네임스페이스 검색',
  'sidebar.clear': '지우기',
  'sidebar.noMatch': '일치하는 네임스페이스 없음',
  'sidebar.resize': '드래그해서 폭 조절',

  'detail.tab.info': '정보',
  'detail.tab.env': '환경',
  'detail.tab.logs': '로그',
  'detail.tab.events': '이벤트',
  'detail.tab.ai': 'AI 분석',
  'detail.status': '상태',
  'detail.restarts': '재시작',
  'detail.node': '노드',
  'detail.memory': '메모리',
  'detail.gpuAlloc': 'GPU 할당',
  'detail.gpuUtil': 'GPU 사용률',
  'detail.gpuMem': 'GPU 메모리',
  'detail.containers': '컨테이너',
  'detail.labels': '레이블',
  'detail.envTitle': '{name} — 환경변수',
  'detail.noEnv': '환경변수 없음',
  'detail.ports': '포트: {v}',
  'detail.mounts': '마운트: {v}',
  'detail.volumes': '볼륨',
  'detail.envAll': '(전체)',
  'detail.volOther': '기타',
  'detail.noEvents': '최근 이벤트가 없습니다.',
  'detail.conditions': '컨디션',

  'ai.notConfigured': 'AI 분석이 설정되지 않았습니다.',
  'ai.notConfiguredHint': '설정(⚙) → AI 분석 설정에서 모델 엔드포인트를 등록하세요.',
  'ai.running': '분석 중… (최대 2분)',
  'ai.rerun': '다시 분석',
  'ai.run': '분석 실행',
  'ai.waiting': 'Pod 상태·이벤트·최근 로그를 수집해서 모델에 전달했습니다. 응답을 기다리는 중…',
  'ai.model': '분석 모델: {m}',
  'ai.intro':
    '분석 실행을 누르면 이 Pod의 상태, 컨디션, K8s 이벤트, 최근 로그를 모아 선택한 AI 모델에게 장애 요인 분석을 요청합니다. 환경변수 값 등 민감정보는 전송하지 않습니다.',

  'logs.failed': '로그 조회 실패 ({status})',
  'logs.follow': '실시간',
  'logs.loading': '로그를 불러오는 중…',

  'login.failed': '로그인 실패',
  'login.username': '아이디',
  'login.password': '비밀번호',
  'login.busy': '로그인 중…',
  'login.submit': '로그인',
  'login.or': '또는',
  'login.sso': 'SSO(Keycloak) 로그인',

  'api.requestFailed': '요청 실패 ({status})',
  'api.analyzeFailed': '분석 요청 실패 ({status})',
  'api.loginFailed': '로그인 실패 ({status})',

  'topo.routing': '트래픽 라우팅 중',
  'topo.excluded': '트래픽 제외 (Not Ready)',
  'topo.cpuRing': 'CPU 사용량 링',
  'topo.gpuRing': 'GPU 사용률 링 (0~100%)',
  'topo.flowLegend': '실측 플로우 — 점 속도 = 세기',
  'topo.resetLayout': '배치 초기화',
  'topo.noteMeasured': '※ 점 속도·개수 = 실측 트래픽 세기, 흐린 선 = 트래픽 없음',
  'topo.noteSelector': '※ 셀렉터 기반 라우팅 경로이며 실측 트래픽이 아닙니다',
  'topo.ingSvc': 'Ingress {ing}\n→ 서비스 {svc}',
  'topo.svcPod': '서비스 {svc}\n→ Pod {pod}',
  'topo.notReady': 'Not Ready — 트래픽 제외',
  'topo.rxtx': '수신 {rx}/s · 송신 {tx}/s',
  'topo.noTraffic': ' (트래픽 없음)',
  'topo.flow': '실측 플로우\n{from}\n→ {to}',
  'topo.fromTx': '출발 Pod 송신 {v}/s',
  'topo.toRx': '도착 Pod 수신 {v}/s',
  'topo.noHost': '(host 없음)',
  'topo.dragMove': '드래그해서 이동',
  'topo.dragResize': '드래그해서 크기 조절',
  'topo.podStatus': '상태: {status} · Ready {ready}',
  'topo.problem': '문제 {label}',
  'topo.gpuAlloc': 'GPU 할당 {n}개',
  'topo.unassigned': '(미할당)',

  'settings.title': '설정',
  'settings.general': '일반',
  'settings.language': '언어',
  'settings.languageDesc': '이 브라우저에 저장됩니다. 서버 메시지와 AI 분석 보고서 언어에도 적용됩니다.',

  'admin.cluster.title': '클러스터 관리',
  'admin.cluster.desc': '다른 망의 podview 주소를 등록하면 상단 클러스터 선택에 나타납니다. 토큰은 해당 인스턴스의 {code} 값입니다.',
  'admin.name': '이름',
  'admin.token': '토큰',
  'admin.tokenSet': '설정됨',
  'admin.role': '역할',
  'admin.email': '이메일',
  'admin.cluster.empty': '등록된 원격 클러스터가 없습니다',
  'admin.cluster.namePh': '이름 (예: 1번서버)',
  'admin.cluster.urlPh': 'URL (예: https://podview.net2.internal)',
  'admin.cluster.tokenPh': 'GATEWAY_TOKEN (수정 시 비우면 유지)',
  'admin.cluster.confirmDelete': '클러스터 "{name}" 등록을 삭제할까요? (원격 클러스터 자체는 영향 없음)',

  'admin.users.title': '사용자 관리',
  'admin.users.desc':
    '기존 사용자명을 입력하면 역할 변경/비밀번호 재설정이 됩니다 (비밀번호는 입력 시에만 변경). 환경변수({code})로 등록된 부트스트랩 계정은 여기에 나오지 않으며 항상 admin입니다.',
  'admin.users.username': '사용자명',
  'admin.users.empty': '웹에서 등록된 사용자가 없습니다',
  'admin.users.passwordPh': '비밀번호 (8자 이상)',
  'admin.users.confirmDelete': '사용자 "{name}"를 삭제할까요?',

  'admin.oidc.title': 'SSO(Keycloak) 사용자 역할',
  'admin.oidc.desc':
    'SSO로 로그인하는 사용자의 이메일에 역할을 미리 지정합니다. 지정하지 않은 SSO 사용자는 로그인 시 조회자로 처리됩니다. 환경변수 {code}에 등록된 계정은 항상 관리자이며 여기서 강등되지 않습니다(부트스트랩용).',
  'admin.oidc.empty': '지정된 SSO 사용자가 없습니다 (모두 조회자로 로그인)',
  'admin.oidc.emailPh': '이메일 (예: user@example.com)',
  'admin.oidc.confirmDelete': 'SSO 사용자 "{name}" 역할 지정을 삭제할까요? (삭제 후 다음 로그인부터 조회자로 처리)',

  'admin.ai.title': 'AI 분석 설정',
  'admin.ai.desc':
    'Pod 상세의 AI 분석 탭이 사용할 LLM 엔드포인트입니다. 여러 개를 등록해두고 분석 시 선택할 수 있으며, 기본으로 지정한 모델이 기본 선택됩니다. vLLM·Ollama·LiteLLM 등 OpenAI 호환 API는 {openai}, Anthropic Messages API 형식은 {anthropic}. URL은 베이스 주소만 입력합니다 (예: {example}).',
  'admin.ai.provider': '형식',
  'admin.ai.urlModel': 'URL / 모델',
  'admin.ai.default': '기본',
  'admin.ai.makeDefault': '기본으로',
  'admin.ai.keySet': ' · 키 설정됨',
  'admin.ai.empty': '등록된 AI 모델이 없습니다',
  'admin.ai.namePh': '이름 (예: llm-7b)',
  'admin.ai.openai': 'OpenAI 호환',
  'admin.ai.anthropic': 'Anthropic 호환',
  'admin.ai.urlPh': '베이스 URL',
  'admin.ai.modelPh': '모델 이름',
  'admin.ai.keyPh': 'API 키 (선택 — 수정 시 비우면 유지)',
  'admin.ai.confirmDelete': 'AI 모델 "{name}" 등록을 삭제할까요?',
}

const DICTS: Record<Lang, Record<MessageKey, string>> = { en, ko }
const STORAGE_KEY = 'podview-lang'

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'en' || saved === 'ko') return saved
  } catch {
    /* 저장소가 막힌 환경 — 기본값 사용 */
  }
  return 'en'
}

// React 밖(api.ts 등)에서도 현재 언어를 알 수 있도록 모듈 변수로 유지한다
let current: Lang = initialLang()

export function currentLang(): Lang {
  return current
}

export type Vars = Record<string, string | number>
export type TFunc = (key: MessageKey, vars?: Vars) => string

/** 사전에서 문구를 찾아 {이름} 자리를 vars로 채운다. 남은 자리표시자는 그대로 둔다 (rich()에서 사용). */
export function translate(key: MessageKey, vars?: Vars, lang: Lang = current): string {
  const s = DICTS[lang][key] ?? en[key]
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

/** 문구 안의 {이름} 자리에 <code> 같은 React 요소를 끼워 넣는다. */
export function rich(template: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return template.split(/\{(\w+)\}/).map((part, i) => (i % 2 === 1 ? <span key={i}>{nodes[part] ?? `{${part}}`}</span> : part))
}

interface I18nValue {
  lang: Lang
  setLang: (l: Lang) => void
  t: TFunc
}

const I18nContext = createContext<I18nValue>({ lang: current, setLang: () => {}, t: (k, v) => translate(k, v) })

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    current = l
    try {
      localStorage.setItem(STORAGE_KEY, l)
    } catch {
      /* 저장 실패는 무시 — 이번 세션에만 적용 */
    }
    setLangState(l)
  }, [])

  const t = useCallback<TFunc>((key, vars) => translate(key, vars, lang), [lang])
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext)
}

/** 언어 선택 드롭다운 (설정 화면·로그인 화면에서 공통 사용) */
export function LanguageSelect({ className, id }: { className?: string; id?: string }) {
  const { lang, setLang, t } = useI18n()
  return (
    <select id={id} className={className} value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('settings.language')}>
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  )
}
