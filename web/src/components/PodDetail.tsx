import { useEffect, useState } from 'react'
import type { GPUUsage, PodDetailInfo, PodSummary, PodUsage } from '../lib/types'
import { formatAge, formatCPU, formatMemory, statusClass } from '../lib/format'
import { analyzePod, fetchAIStatus, fetchPodDetail } from '../lib/api'
import { LogViewer } from './LogViewer'
import { useI18n } from '../lib/i18n'

interface Props {
  pod: PodSummary
  usage?: PodUsage
  gpu?: GPUUsage
  cluster?: string
  onClose: () => void
}

type Tab = 'info' | 'env' | 'logs' | 'events' | 'ai'

export function PodDetail({ pod, usage, gpu, cluster = '', onClose }: Props) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('info')
  const [detail, setDetail] = useState<PodDetailInfo | null>(null)
  const cls = statusClass(pod.status, pod.phase)

  // 환경/이벤트 탭에 처음 들어갈 때 상세 정보를 가져온다.
  useEffect(() => {
    if ((tab === 'env' || tab === 'events') && !detail) {
      fetchPodDetail(pod.namespace, pod.name, cluster).then(setDetail).catch(() => {})
    }
  }, [tab, detail, pod.namespace, pod.name, cluster])

  // Pod가 바뀌면 상세 캐시를 비운다.
  useEffect(() => {
    setDetail(null)
    setTab('info')
  }, [pod.namespace, pod.name])

  return (
    <aside className="detail">
      <div className="detail-head">
        <div>
          <div className="detail-title">
            <span className={`status-dot ${cls}`} /> {pod.name}
          </div>
          <div className="detail-sub">{pod.namespace}</div>
        </div>
        <button className="close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="tabs">
        {(
          [
            ['info', t('detail.tab.info')],
            ['env', t('detail.tab.env')],
            ['logs', t('detail.tab.logs')],
            ['events', t('detail.tab.events')],
            ['ai', t('detail.tab.ai')],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} className={tab === key ? 'tab active' : 'tab'} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'info' && <InfoTab pod={pod} usage={usage} gpu={gpu} cls={cls} />}
      {tab === 'env' && <EnvTab detail={detail} />}
      {tab === 'logs' && <LogViewer pod={pod} cluster={cluster} />}
      {tab === 'events' && <EventsTab detail={detail} />}
      {tab === 'ai' && <AITab pod={pod} cluster={cluster} />}
    </aside>
  )
}

function InfoTab({ pod, usage, gpu, cls }: { pod: PodSummary; usage?: PodUsage; gpu?: GPUUsage; cls: string }) {
  const { t } = useI18n()
  return (
    <div className="detail-body">
      <dl className="kv">
        <dt>{t('detail.status')}</dt>
        <dd className={`text-${cls}`}>{pod.status}</dd>
        <dt>Ready</dt>
        <dd>{pod.ready}</dd>
        <dt>{t('detail.restarts')}</dt>
        <dd>{pod.restarts}</dd>
        <dt>{t('detail.node')}</dt>
        <dd>{pod.nodeName || '-'}</dd>
        <dt>Pod IP</dt>
        <dd>{pod.podIP || '-'}</dd>
        <dt>Age</dt>
        <dd>{formatAge(pod.startTime)}</dd>
        {usage && (
          <>
            <dt>CPU</dt>
            <dd>{formatCPU(usage.cpuMilli)}</dd>
            <dt>{t('detail.memory')}</dt>
            <dd>{formatMemory(usage.memoryBytes)}</dd>
          </>
        )}
        {(pod.gpu ?? 0) > 0 && (
          <>
            <dt>{t('detail.gpuAlloc')}</dt>
            <dd>{pod.gpu}</dd>
          </>
        )}
        {gpu && (
          <>
            <dt>{t('detail.gpuUtil')}</dt>
            <dd>{gpu.utilPercent.toFixed(0)}%</dd>
            <dt>{t('detail.gpuMem')}</dt>
            <dd>{formatMemory(gpu.memUsedBytes)}</dd>
          </>
        )}
      </dl>

      <h3>{t('detail.containers')}</h3>
      {(pod.containers ?? []).map((c) => {
        const cu = usage?.containers.find((u) => u.name === c.name)
        return (
          <div key={c.name} className="container-row">
            <div className="container-head">
              <span className={`status-dot ${c.ready ? 'ok' : 'error'}`} />
              <strong>{c.name}</strong>
              <span className="container-state">{c.state}</span>
            </div>
            <div className="container-meta">
              <span title={c.image}>{c.image}</span>
              {c.restarts > 0 && <span>↻ {c.restarts}</span>}
              {cu && (
                <span>
                  {formatCPU(cu.cpuMilli)} / {formatMemory(cu.memoryBytes)}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {pod.labels && Object.keys(pod.labels).length > 0 && (
        <>
          <h3>{t('detail.labels')}</h3>
          <div className="labels">
            {Object.entries(pod.labels).map(([k, v]) => (
              <span key={k} className="label-chip">
                {k}={v}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EnvTab({ detail }: { detail: PodDetailInfo | null }) {
  const { t } = useI18n()
  if (!detail) return <div className="detail-body loading">{t('common.loading')}</div>
  return (
    <div className="detail-body">
      <dl className="kv">
        <dt>SA</dt>
        <dd>{detail.serviceAccount || 'default'}</dd>
        <dt>QoS</dt>
        <dd>{detail.qosClass || '-'}</dd>
      </dl>

      {(detail.containers ?? []).map((c) => (
        <div key={c.name}>
          <h3>{t('detail.envTitle', { name: c.name })}</h3>
          {(c.env ?? []).length === 0 ? (
            <div className="dim-note">{t('detail.noEnv')}</div>
          ) : (
            <table className="env-table">
              <tbody>
                {(c.env ?? []).map((e, i) => (
                  <tr key={i}>
                    {/* 서버는 envFrom 항목 이름을 "*"로 보낸다 (구버전 원격은 "(전체)") */}
                    <td className="env-name">{e.name === '*' ? t('detail.envAll') : e.name}</td>
                    <td className="env-value">{e.source ? <em>{e.source}</em> : e.value || '""'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(c.ports ?? []).length > 0 && (
            <div className="dim-note">{t('detail.ports', { v: (c.ports ?? []).join(', ') })}</div>
          )}
          {(c.mounts ?? []).length > 0 && (
            <div className="dim-note">{t('detail.mounts', { v: (c.mounts ?? []).join(' · ') })}</div>
          )}
        </div>
      ))}

      {(detail.volumes ?? []).length > 0 && (
        <>
          <h3>{t('detail.volumes')}</h3>
          {(detail.volumes ?? []).map((v) => (
            <div key={v.name} className="dim-note">
              {v.name} — {v.type === 'other' ? t('detail.volOther') : v.type}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function EventsTab({ detail }: { detail: PodDetailInfo | null }) {
  const { t } = useI18n()
  if (!detail) return <div className="detail-body loading">{t('common.loading')}</div>
  const events = detail.events ?? []
  return (
    <div className="detail-body">
      {events.length === 0 && <div className="dim-note">{t('detail.noEvents')}</div>}
      {events.map((ev, i) => (
        <div key={i} className={`event-row ${ev.type === 'Warning' ? 'warning' : ''}`}>
          <div className="event-head">
            <strong>{ev.reason}</strong>
            <span className="event-meta">
              {ev.count > 1 ? `×${ev.count} · ` : ''}
              {ev.lastSeen ? t('time.ago', { age: formatAge(ev.lastSeen) }) : ''}
            </span>
          </div>
          <div className="event-msg">{ev.message}</div>
        </div>
      ))}

      {(detail.conditions ?? []).length > 0 && (
        <>
          <h3>{t('detail.conditions')}</h3>
          {(detail.conditions ?? []).map((c) => (
            <div key={c.type} className="dim-note">
              <span className={c.status === 'True' ? 'text-ok' : 'text-warn'}>●</span> {c.type}: {c.status}
              {c.reason ? ` (${c.reason})` : ''}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function AITab({ pod, cluster }: { pod: PodSummary; cluster: string }) {
  const { t } = useI18n()
  const [models, setModels] = useState<string[]>([])
  const [selected, setSelected] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState('')
  const [resultModel, setResultModel] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    fetchAIStatus(cluster)
      .then((s) => {
        setModels(s.models ?? [])
        setSelected(s.active ?? '')
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [cluster])

  // Pod가 바뀌면 이전 분석 결과를 비운다
  useEffect(() => {
    setResult('')
    setError('')
  }, [pod.namespace, pod.name])

  const run = async () => {
    setRunning(true)
    setError('')
    setResult('')
    const res = await analyzePod(pod.namespace, pod.name, selected, cluster)
    setRunning(false)
    if (res.error) setError(res.error)
    else {
      setResult(res.analysis ?? '')
      setResultModel(res.model ?? selected)
    }
  }

  if (!loaded) return <div className="detail-body loading">{t('common.checking')}</div>
  if (models.length === 0) {
    return (
      <div className="detail-body">
        <div className="ai-notice">
          {t('ai.notConfigured')}
          <br />
          {t('ai.notConfiguredHint')}
        </div>
      </div>
    )
  }

  return (
    <div className="detail-body ai-tab">
      <div className="ai-head">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={running}>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <button className="ai-run" onClick={run} disabled={running}>
          {running ? t('ai.running') : result ? t('ai.rerun') : t('ai.run')}
        </button>
      </div>
      {running && (
        <div className="ai-notice">
          {t('ai.waiting')}
        </div>
      )}
      {error && <div className="admin-error">{error}</div>}
      {result && (
        <>
          <div className="ai-model">{t('ai.model', { m: resultModel })}</div>
          <div className="ai-result">{result}</div>
        </>
      )}
      {!running && !result && !error && (
        <div className="dim-note">
          {t('ai.intro')}
        </div>
      )}
    </div>
  )
}
