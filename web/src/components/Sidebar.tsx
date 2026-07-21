import { useEffect, useRef, useState } from 'react'

interface Props {
  namespaces: string[]
  selected: string
  collapsed: boolean
  problemCounts: Map<string, number>
  highlightNS?: string | null
  onToggle: () => void
  onSelect: (ns: string) => void
}

const MIN_W = 160
const MAX_W = 480

export function Sidebar({ namespaces, selected, collapsed, problemCounts, highlightNS, onToggle, onSelect }: Props) {
  const [width, setWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('podview-sidebar-width') ?? '220', 10)
    return Number.isFinite(saved) ? Math.min(MAX_W, Math.max(MIN_W, saved)) : 220
  })
  const [dragging, setDragging] = useState(false)
  const [query, setQuery] = useState('')
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      setWidth(Math.min(MAX_W, Math.max(MIN_W, d.startW + (e.clientX - d.startX))))
    }
    const onUp = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setDragging(false)
      setWidth((w) => {
        localStorage.setItem('podview-sidebar-width', String(w))
        return w
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  const totalProblems = [...problemCounts.values()].reduce((a, b) => a + b, 0)

  // 입력 즉시(onChange) 대소문자 구분 없이 필터링
  const q = query.trim().toLowerCase()
  const filtered = q ? namespaces.filter((ns) => ns.toLowerCase().includes(q)) : namespaces

  if (collapsed) {
    return (
      <nav className="sidebar collapsed">
        <button className="sidebar-toggle" onClick={onToggle} title="네임스페이스 목록 펼치기">
          »
        </button>
        {totalProblems > 0 && <span className="ns-problem rail">{totalProblems}</span>}
        <div className="sidebar-rail-label">{selected || '전체'}</div>
      </nav>
    )
  }

  return (
    <nav className={dragging ? 'sidebar no-anim' : 'sidebar'} style={{ width }}>
      <div className="logo">
        <span>
          <span className="logo-mark">⎈</span> PodView
        </span>
        <button className="sidebar-toggle" onClick={onToggle} title="네임스페이스 목록 접기">
          «
        </button>
      </div>
      <div className="ns-search">
        <input
          className="ns-search-input"
          placeholder="네임스페이스 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="ns-search-clear" onClick={() => setQuery('')} title="지우기">
            ✕
          </button>
        )}
      </div>
      <div className="ns-list">
        {/* 검색 중이 아닐 때만 "전체" 항목 노출 */}
        {!q && (
          <button className={selected === '' ? 'ns active' : 'ns'} onClick={() => onSelect('')}>
            <span className="ns-name">전체 네임스페이스</span>
            {totalProblems > 0 && <span className="ns-problem">{totalProblems}</span>}
          </button>
        )}
        {filtered.map((ns) => {
          const problems = problemCounts.get(ns) ?? 0
          const cls = ['ns', selected === ns ? 'active' : '', highlightNS === ns ? 'hovered' : '']
            .filter(Boolean)
            .join(' ')
          return (
            <button key={ns} className={cls} onClick={() => onSelect(ns)}>
              <span className="ns-name" title={ns}>
                {ns}
              </span>
              {problems > 0 && <span className="ns-problem">{problems}</span>}
            </button>
          )
        })}
        {q && filtered.length === 0 && <div className="ns-empty">일치하는 네임스페이스 없음</div>}
      </div>
      {/* 오른쪽 가장자리 드래그 → 폭 조절 */}
      <div
        className="sidebar-resize"
        title="드래그해서 폭 조절"
        onMouseDown={(e) => {
          e.preventDefault()
          dragRef.current = { startX: e.clientX, startW: width }
          setDragging(true)
        }}
      />
    </nav>
  )
}
