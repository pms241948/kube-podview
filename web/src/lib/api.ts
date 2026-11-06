import { currentLang, translate } from './i18n'
import type { AuthMethods, GPUSnapshot, MetricsResponse, PodDetailInfo, Topology, TrafficSnapshot, UserInfo } from './types'

/**
 * cluster가 빈 문자열이면 이 인스턴스(로컬 클러스터)를 직접 조회하고,
 * 이름이 있으면 게이트웨이 프록시(/proxy/{cluster})를 통해 원격 podview를 조회한다.
 */
export function apiBase(cluster: string): string {
  return cluster ? `/proxy/${encodeURIComponent(cluster)}` : ''
}

/** 선택한 화면 언어를 서버에 알린다 — 서버 오류 메시지와 AI 분석 보고서 언어에 쓰인다 (게이트웨이 프록시도 그대로 전달). */
export function langHeaders(extra?: Record<string, string>): Record<string, string> {
  return { 'Accept-Language': currentLang(), ...extra }
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: langHeaders() })
  if (res.status === 401) {
    // 세션 만료 → 로그인 페이지로
    window.location.href = '/login'
    throw new Error('unauthorized')
  }
  if (!res.ok) throw new Error(`${url}: ${translate('api.requestFailed', { status: res.status })}`)
  return res.json()
}

function nsQuery(namespace: string): string {
  return namespace ? `?namespace=${encodeURIComponent(namespace)}` : ''
}

export function fetchNamespaces(cluster = ''): Promise<{ namespaces: string[] }> {
  return getJSON(`${apiBase(cluster)}/api/namespaces`)
}

export function fetchMetrics(namespace: string, cluster = ''): Promise<MetricsResponse> {
  return getJSON(`${apiBase(cluster)}/api/metrics/pods${nsQuery(namespace)}`)
}

export function fetchTopology(namespace: string, cluster = ''): Promise<Topology> {
  return getJSON(`${apiBase(cluster)}/api/topology${nsQuery(namespace)}`)
}

export function fetchTraffic(namespace: string, cluster = ''): Promise<TrafficSnapshot> {
  return getJSON(`${apiBase(cluster)}/api/traffic${nsQuery(namespace)}`)
}

export function fetchGPU(namespace: string, cluster = ''): Promise<GPUSnapshot> {
  return getJSON(`${apiBase(cluster)}/api/gpu${nsQuery(namespace)}`)
}

export function fetchPodDetail(namespace: string, pod: string, cluster = ''): Promise<PodDetailInfo> {
  return getJSON(
    `${apiBase(cluster)}/api/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/detail`,
  )
}

export function fetchPods(namespace: string, cluster = ''): Promise<{ pods: import('./types').PodSummary[] }> {
  return getJSON(`${apiBase(cluster)}/api/pods${nsQuery(namespace)}`)
}

export function fetchClusters(): Promise<{ clusters: string[] }> {
  return getJSON('/api/clusters')
}

export function fetchAIStatus(
  cluster = '',
): Promise<{ configured: boolean; models: string[]; active: string }> {
  return getJSON(`${apiBase(cluster)}/api/ai/status`)
}

export async function analyzePod(
  namespace: string,
  pod: string,
  model = '',
  cluster = '',
): Promise<{ analysis?: string; model?: string; error?: string }> {
  const res = await fetch(
    `${apiBase(cluster)}/api/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/analyze`,
    { method: 'POST', headers: langHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ model }) },
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { error: body.error ?? translate('api.analyzeFailed', { status: res.status }) }
  return body
}

export async function fetchMe(): Promise<UserInfo> {
  const res = await fetch('/auth/me', { headers: langHeaders() })
  if (!res.ok) return { authenticated: false }
  return res.json()
}

export async function fetchAuthMethods(): Promise<AuthMethods> {
  const res = await fetch('/auth/methods', { headers: langHeaders() })
  if (!res.ok) return { enabled: false, oidc: false, local: false }
  return res.json()
}

export async function loginLocal(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/auth/local', {
    method: 'POST',
    headers: langHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ username, password }),
  })
  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({ error: translate('api.loginFailed', { status: res.status }) }))
  return { ok: false, error: body.error }
}

export function logsURL(
  namespace: string,
  pod: string,
  opts: { container?: string; tailLines?: number; follow?: boolean } = {},
  cluster = '',
): string {
  const params = new URLSearchParams()
  if (opts.container) params.set('container', opts.container)
  if (opts.tailLines) params.set('tailLines', String(opts.tailLines))
  if (opts.follow) params.set('follow', 'true')
  const q = params.toString()
  return `${apiBase(cluster)}/api/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/logs${q ? '?' + q : ''}`
}

// ── 관리자 API ────────────────────────────────────────

export interface AdminCluster {
  name: string
  url: string
  hasToken: boolean
}

export interface AdminUser {
  username: string
  role: string
}

export interface AdminOIDCUser {
  email: string
  role: string
}

async function send(method: string, url: string, body?: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method,
    headers: langHeaders(body ? { 'Content-Type': 'application/json' } : undefined),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.ok) return { ok: true }
  const data = await res.json().catch(() => ({ error: translate('api.requestFailed', { status: res.status }) }))
  return { ok: false, error: data.error }
}

export interface AdminAIModel {
  name: string
  provider: string
  url: string
  model: string
  hasKey: boolean
}

export const adminAPI = {
  listClusters: (): Promise<{ clusters: AdminCluster[] }> => getJSON('/api/admin/clusters'),
  saveCluster: (name: string, url: string, token: string) => send('POST', '/api/admin/clusters', { name, url, token }),
  deleteCluster: (name: string) => send('DELETE', `/api/admin/clusters/${encodeURIComponent(name)}`),
  listUsers: (): Promise<{ users: AdminUser[] }> => getJSON('/api/admin/users'),
  saveUser: (username: string, password: string, role: string) =>
    send('POST', '/api/admin/users', { username, password, role }),
  deleteUser: (username: string) => send('DELETE', `/api/admin/users/${encodeURIComponent(username)}`),
  listOIDCUsers: (): Promise<{ users: AdminOIDCUser[] }> => getJSON('/api/admin/oidc-users'),
  saveOIDCUser: (email: string, role: string) => send('POST', '/api/admin/oidc-users', { email, role }),
  deleteOIDCUser: (email: string) => send('DELETE', `/api/admin/oidc-users/${encodeURIComponent(email)}`),
  listAI: (): Promise<{ models: AdminAIModel[]; active: string }> => getJSON('/api/admin/ai'),
  saveAI: (name: string, provider: string, url: string, model: string, apiKey: string) =>
    send('POST', '/api/admin/ai', { name, provider, url, model, apiKey }),
  deleteAI: (name: string) => send('DELETE', `/api/admin/ai/${encodeURIComponent(name)}`),
  setActiveAI: (name: string) => send('POST', '/api/admin/ai/active', { name }),
}
