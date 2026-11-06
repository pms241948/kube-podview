import { useEffect, useRef, useState } from 'react'
import type { PodSummary } from '../lib/types'
import { logsURL } from '../lib/api'
import { useI18n } from '../lib/i18n'

interface Props {
  pod: PodSummary
  cluster?: string
}

export function LogViewer({ pod, cluster = '' }: Props) {
  const { t } = useI18n()
  const [container, setContainer] = useState(pod.containers?.[0]?.name ?? '')
  const [follow, setFollow] = useState(true)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    setText('')
    setError('')
    const controller = new AbortController()

    const run = async () => {
      try {
        const res = await fetch(logsURL(pod.namespace, pod.name, { container, tailLines: 500, follow }, cluster), {
          signal: controller.signal,
        })
        if (!res.ok) {
          setError(t('logs.failed', { status: res.status }))
          return
        }
        if (!res.body) return
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          setText((prev) => {
            const next = prev + decoder.decode(value, { stream: true })
            // 메모리 보호: 최근 1MB만 유지
            return next.length > 1_000_000 ? next.slice(-1_000_000) : next
          })
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(String(e))
      }
    }
    run()
    return () => controller.abort()
  }, [pod.namespace, pod.name, container, follow, cluster])

  // 새 로그가 오면 맨 아래로 스크롤
  useEffect(() => {
    const el = preRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="log-viewer">
      <div className="log-controls">
        <select value={container} onChange={(e) => setContainer(e.target.value)}>
          {(pod.containers ?? []).map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {t('logs.follow')}
        </label>
      </div>
      {error ? <div className="log-error">{error}</div> : <pre ref={preRef} className="log-output">{text || t('logs.loading')}</pre>}
    </div>
  )
}
