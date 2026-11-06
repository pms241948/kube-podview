import type { KeyboardEvent } from 'react'
import type { PodSummary, PodUsage } from '../lib/types'
import { formatAge, formatCPU, formatMemory, problemLabel, problemRecency, statusClass } from '../lib/format'
import { useI18n, type MessageKey, type TFunc } from '../lib/i18n'

type StatusClass = 'ok' | 'warn' | 'error' | 'done'

/** 네임스페이스 하나의 Pod 상태·리소스 집계. 전체 네임스페이스 화면의 카드 한 장에 해당한다. */
export interface NamespaceSummary {
  ns: string
  total: number
  byClass: Record<StatusClass, number>
  problemPods: PodSummary[] // 문제 Pod 전체, 최근 발생순
  cpuMilli: number
  memoryBytes: number
  hasUsage: boolean
  gpuAlloc: number
}

/** 카드에 이름까지 보여줄 문제 Pod 수. 나머지는 "외 N개"로 줄인다. */
const MAX_PROBLEM_ROWS = 2

/** 좁은 카드 줄에 맞춘 짧은 발생 시점 표기 ("55s ago" / "chronic 3d2h"). 전체 문구는 툴팁에 둔다. */
function shortRecency(problemSince: string, t: TFunc): string {
  const age = formatAge(problemSince)
  return t(problemRecency(problemSince) === 'chronic' ? 'recency.shortChronic' : 'time.ago', { age })
}

/** 전체 Pod 목록을 네임스페이스별로 집계한다. Pod가 없는 네임스페이스도 namespaces에 있으면 포함한다. */
export function summarizeNamespaces(
  namespaces: string[],
  pods: PodSummary[],
  usage: Map<string, PodUsage>,
): NamespaceSummary[] {
  const m = new Map<string, NamespaceSummary>()
  const get = (ns: string) => {
    let s = m.get(ns)
    if (!s) {
      s = { ns, total: 0, byClass: { ok: 0, warn: 0, error: 0, done: 0 }, problemPods: [], cpuMilli: 0, memoryBytes: 0, hasUsage: false, gpuAlloc: 0 }
      m.set(ns, s)
    }
    return s
  }
  for (const ns of namespaces) get(ns)
  for (const p of pods) {
    const s = get(p.namespace)
    s.total++
    s.byClass[statusClass(p.status, p.phase) as StatusClass]++
    if (p.problemSince) s.problemPods.push(p)
    const u = usage.get(`${p.namespace}/${p.name}`)
    if (u) {
      s.cpuMilli += u.cpuMilli
      s.memoryBytes += u.memoryBytes
      s.hasUsage = true
    }
    // GPU 사용률은 Pod 단위 지표라 합산하지 않고 할당 개수만 집계한다
    s.gpuAlloc += p.gpu ?? 0
  }
  for (const s of m.values()) s.problemPods.sort((a, b) => (a.problemSince! < b.problemSince! ? 1 : -1))

  // 문제 있는 네임스페이스를 최근 발생순으로 위에, 나머지는 이름순. Pod 없는 네임스페이스는 맨 뒤.
  const latest = (s: NamespaceSummary) => s.problemPods[0]?.problemSince
  return [...m.values()].sort((a, b) => {
    const la = latest(a)
    const lb = latest(b)
    if (!!la !== !!lb) return la ? -1 : 1
    if (la && lb && la !== lb) return la > lb ? -1 : 1
    if ((a.total === 0) !== (b.total === 0)) return a.total === 0 ? 1 : -1
    return a.ns.localeCompare(b.ns)
  })
}

// ── 전체 네임스페이스 화면의 카드 필터 ──────────────────────

/** all: 전체 / problem: 문제 Pod가 있는 네임스페이스 / recent: 24시간 이내 새 문제가 생긴 네임스페이스 */
export type NsFilter = 'all' | 'problem' | 'recent'

function hasRecentProblem(s: NamespaceSummary): boolean {
  // problemPods는 최근 발생순이므로 첫 Pod만 보면 된다
  const latest = s.problemPods[0]?.problemSince
  return !!latest && problemRecency(latest) !== 'chronic'
}

function matches(s: NamespaceSummary, f: NsFilter, hideEmpty: boolean): boolean {
  if (f === 'problem') return s.problemPods.length > 0
  if (f === 'recent') return hasRecentProblem(s)
  return !(hideEmpty && s.total === 0)
}

export function filterNamespaces(list: NamespaceSummary[], f: NsFilter, hideEmpty: boolean): NamespaceSummary[] {
  return list.filter((s) => matches(s, f, hideEmpty))
}

const FILTERS: { key: NsFilter; label: MessageKey; title: MessageKey }[] = [
  { key: 'all', label: 'ns.filter.all', title: 'ns.filter.allTitle' },
  { key: 'problem', label: 'ns.filter.problem', title: 'ns.filter.problemTitle' },
  { key: 'recent', label: 'ns.filter.recent', title: 'ns.filter.recentTitle' },
]

/** 필터 결과가 비었을 때의 안내 문구 키 */
export const EMPTY_MESSAGE: Record<NsFilter, MessageKey> = {
  all: 'ns.empty.all',
  problem: 'ns.empty.problem',
  recent: 'ns.empty.recent',
}

interface FilterBarProps {
  summaries: NamespaceSummary[]
  value: NsFilter
  hideEmpty: boolean
  onChange: (f: NsFilter) => void
  onHideEmptyChange: (v: boolean) => void
}

export function NamespaceFilterBar({ summaries, value, hideEmpty, onChange, onHideEmptyChange }: FilterBarProps) {
  const { t } = useI18n()
  return (
    <div className="ns-filter-bar">
      <div className="ns-filter-seg" role="radiogroup" aria-label={t('ns.filterLabel')}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="radio"
            aria-checked={value === f.key}
            className={value === f.key ? 'active' : ''}
            title={t(f.title)}
            onClick={() => onChange(f.key)}
          >
            {t(f.label)} <span className="ns-filter-count">{filterNamespaces(summaries, f.key, hideEmpty).length}</span>
          </button>
        ))}
      </div>
      {/* 빈 네임스페이스는 "전체"에서만 나오므로 그때만 체크박스가 의미 있다 */}
      <label className={`ns-filter-check ${value === 'all' ? '' : 'disabled'}`}>
        <input type="checkbox" checked={hideEmpty} disabled={value !== 'all'} onChange={(e) => onHideEmptyChange(e.target.checked)} />
        {t('ns.hideEmpty')}
      </label>
    </div>
  )
}

interface Props {
  summary: NamespaceSummary
  onOpen: () => void // 카드 클릭 → 해당 네임스페이스 토폴로지
  onSelectPod: (pod: PodSummary) => void // 문제 Pod 줄 클릭 → 바로 상세 패널
  onHover: (ns: string | null) => void
}

// 문제가 먼저 눈에 들어오도록 오류 → 대기 → 정상 → 완료 순으로 칩을 놓는다
const CHIPS: { cls: StatusClass; label: MessageKey }[] = [
  { cls: 'error', label: 'status.error' },
  { cls: 'warn', label: 'status.warn' },
  { cls: 'ok', label: 'status.ok' },
  { cls: 'done', label: 'status.done' },
]

export function NamespaceCard({ summary: s, onOpen, onSelectPod, onHover }: Props) {
  const { t } = useI18n()
  const empty = s.total === 0
  const latest = s.problemPods[0]?.problemSince
  const recency = latest ? problemRecency(latest) : null
  const shown = s.problemPods.slice(0, MAX_PROBLEM_ROWS)
  const more = s.problemPods.length - shown.length

  // 카드 안에 문제 Pod 버튼이 들어가므로 카드 자체는 button 대신 role="button"을 쓴다 (button 중첩 불가)
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`pod-card ns-card ${empty ? 'empty-ns' : ''} ${recency ? `has-problem ${recency}` : ''}`}
      onClick={onOpen}
      onKeyDown={onKey}
      onMouseEnter={() => onHover(s.ns)}
      onMouseLeave={() => onHover(null)}
      title={t('ns.openTopology', { ns: s.ns })}
    >
      <div className="pod-card-head">
        <span className={`status-dot ${s.problemPods.length > 0 ? 'error' : empty ? 'done' : 'ok'}`} />
        <span className="pod-name" title={s.ns}>
          {s.ns}
        </span>
        {s.gpuAlloc > 0 && <span className="gpu-badge">GPU×{s.gpuAlloc}</span>}
      </div>

      {empty ? (
        <div className="pod-meta">{t('ns.noPods')}</div>
      ) : (
        <>
          <div className="ns-chips">
            {CHIPS.filter((c) => s.byClass[c.cls] > 0).map((c) => (
              <span key={c.cls} className={`ns-chip ${c.cls}`}>
                {t(c.label)} {s.byClass[c.cls]}
              </span>
            ))}
          </div>

          {shown.length > 0 && (
            <ul className="nsc-problems">
              {shown.map((p) => (
                <li key={p.name}>
                  <button
                    className="nsc-problem"
                    title={t('ns.podDetails', { name: p.name })}
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectPod(p)
                    }}
                  >
                    <span className={`status-dot ${statusClass(p.status, p.phase)}`} />
                    <span className="nsc-problem-name">{p.name}</span>
                    <span
                      className={`nsc-problem-meta ${problemRecency(p.problemSince!)}`}
                      title={`${p.status} · ${problemLabel(p.problemSince!, t)}`}
                    >
                      {p.status} · {shortRecency(p.problemSince!, t)}
                    </span>
                  </button>
                </li>
              ))}
              {more > 0 && <li className="nsc-problem-more">{t('ns.more', { n: more })}</li>}
            </ul>
          )}

          {s.hasUsage && (
            <div className="pod-usage">
              <span>CPU {formatCPU(s.cpuMilli)}</span>
              <span>MEM {formatMemory(s.memoryBytes)}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
