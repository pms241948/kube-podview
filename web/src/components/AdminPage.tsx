import { useEffect, useState } from 'react'
import { adminAPI, type AdminAIModel, type AdminCluster, type AdminOIDCUser, type AdminUser } from '../lib/api'

interface Props {
  onClose: () => void
  onClustersChanged: () => void
}

/** 관리자 설정: 클러스터 등록과 사용자 계정 관리 */
export function AdminPage({ onClose, onClustersChanged }: Props) {
  return (
    <div className="admin-page">
      <div className="admin-head">
        <h2>관리자 설정</h2>
        <button className="close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="admin-body">
        <ClusterSection onChanged={onClustersChanged} />
        <UserSection />
        <OIDCUserSection />
        <AISection />
      </div>
    </div>
  )
}

function ClusterSection({ onChanged }: { onChanged: () => void }) {
  const [clusters, setClusters] = useState<AdminCluster[]>([])
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [msg, setMsg] = useState('')

  const reload = () => adminAPI.listClusters().then((r) => setClusters(r.clusters)).catch(() => {})
  useEffect(() => {
    reload()
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    const res = await adminAPI.saveCluster(name.trim(), url.trim(), token)
    if (!res.ok) {
      setMsg(res.error ?? '저장 실패')
      return
    }
    setName('')
    setUrl('')
    setToken('')
    reload()
    onChanged()
  }

  const remove = async (n: string) => {
    if (!confirm(`클러스터 "${n}" 등록을 삭제할까요? (원격 클러스터 자체는 영향 없음)`)) return
    await adminAPI.deleteCluster(n)
    reload()
    onChanged()
  }

  return (
    <section className="admin-section">
      <h3>클러스터 관리</h3>
      <p className="admin-desc">
        다른 망의 podview 주소를 등록하면 상단 클러스터 선택에 나타납니다. 토큰은 해당 인스턴스의{' '}
        <code>GATEWAY_TOKEN</code> 값입니다.
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>URL</th>
            <th>토큰</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td className="mono">{c.url}</td>
              <td>{c.hasToken ? '설정됨' : '—'}</td>
              <td>
                <button className="danger" onClick={() => remove(c.name)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {clusters.length === 0 && (
            <tr>
              <td colSpan={4} className="admin-empty">
                등록된 원격 클러스터가 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input placeholder="이름 (예: 1번서버)" value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder="URL (예: https://podview.net2.internal)" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input placeholder="GATEWAY_TOKEN (수정 시 비우면 유지)" value={token} onChange={(e) => setToken(e.target.value)} />
        <button type="submit">추가 / 수정</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}

function UserSection() {
  const [users, setUsers] = useState<AdminUser[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('viewer')
  const [msg, setMsg] = useState('')

  const reload = () => adminAPI.listUsers().then((r) => setUsers(r.users)).catch(() => {})
  useEffect(() => {
    reload()
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    const res = await adminAPI.saveUser(username.trim(), password, role)
    if (!res.ok) {
      setMsg(res.error ?? '저장 실패')
      return
    }
    setUsername('')
    setPassword('')
    setRole('viewer')
    reload()
  }

  const remove = async (u: string) => {
    if (!confirm(`사용자 "${u}"를 삭제할까요?`)) return
    await adminAPI.deleteUser(u)
    reload()
  }

  return (
    <section className="admin-section">
      <h3>사용자 관리</h3>
      <p className="admin-desc">
        기존 사용자명을 입력하면 역할 변경/비밀번호 재설정이 됩니다 (비밀번호는 입력 시에만 변경).
        환경변수(<code>LOCAL_USERS</code>)로 등록된 부트스트랩 계정은 여기에 나오지 않으며 항상 admin입니다.
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>사용자명</th>
            <th>역할</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>{u.role === 'admin' ? '관리자' : '조회자'}</td>
              <td>
                <button className="danger" onClick={() => remove(u.username)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={3} className="admin-empty">
                웹에서 등록된 사용자가 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input placeholder="사용자명" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
        <input
          type="password"
          placeholder="비밀번호 (8자 이상)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">조회자</option>
          <option value="admin">관리자</option>
        </select>
        <button type="submit">추가 / 수정</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}

function OIDCUserSection() {
  const [users, setUsers] = useState<AdminOIDCUser[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [msg, setMsg] = useState('')

  const reload = () => adminAPI.listOIDCUsers().then((r) => setUsers(r.users)).catch(() => {})
  useEffect(() => {
    reload()
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    const res = await adminAPI.saveOIDCUser(email.trim(), role)
    if (!res.ok) {
      setMsg(res.error ?? '저장 실패')
      return
    }
    setEmail('')
    setRole('viewer')
    reload()
  }

  const remove = async (em: string) => {
    if (!confirm(`SSO 사용자 "${em}" 역할 지정을 삭제할까요? (삭제 후 다음 로그인부터 조회자로 처리)`)) return
    await adminAPI.deleteOIDCUser(em)
    reload()
  }

  return (
    <section className="admin-section">
      <h3>SSO(Keycloak) 사용자 역할</h3>
      <p className="admin-desc">
        SSO로 로그인하는 사용자의 <strong>이메일</strong>에 역할을 미리 지정합니다. 지정하지 않은 SSO
        사용자는 로그인 시 <strong>조회자</strong>로 처리됩니다. 환경변수 <code>OIDC_ADMIN_EMAILS</code>에
        등록된 계정은 항상 관리자이며 여기서 강등되지 않습니다(부트스트랩용).
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>이메일</th>
            <th>역할</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.email}>
              <td className="mono">{u.email}</td>
              <td>{u.role === 'admin' ? '관리자' : '조회자'}</td>
              <td>
                <button className="danger" onClick={() => remove(u.email)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={3} className="admin-empty">
                지정된 SSO 사용자가 없습니다 (모두 조회자로 로그인)
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input
          type="email"
          placeholder="이메일 (예: user@example.com)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">조회자</option>
          <option value="admin">관리자</option>
        </select>
        <button type="submit">추가 / 수정</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}

function AISection() {
  const [models, setModels] = useState<AdminAIModel[]>([])
  const [active, setActive] = useState('')
  const [name, setName] = useState('')
  const [provider, setProvider] = useState('openai')
  const [url, setUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [msg, setMsg] = useState('')

  const reload = () =>
    adminAPI
      .listAI()
      .then((r) => {
        setModels(r.models)
        setActive(r.active)
      })
      .catch(() => {})

  useEffect(() => {
    reload()
  }, [])

  const clearForm = () => {
    setName('')
    setProvider('openai')
    setUrl('')
    setModel('')
    setApiKey('')
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg('')
    const res = await adminAPI.saveAI(name.trim(), provider, url.trim(), model.trim(), apiKey)
    if (!res.ok) {
      setMsg(res.error ?? '저장 실패')
      return
    }
    clearForm()
    reload()
  }

  const edit = (m: AdminAIModel) => {
    setName(m.name)
    setProvider(m.provider)
    setUrl(m.url)
    setModel(m.model)
    setApiKey('')
  }

  const remove = async (n: string) => {
    if (!confirm(`AI 모델 "${n}" 등록을 삭제할까요?`)) return
    await adminAPI.deleteAI(n)
    reload()
  }

  const makeActive = async (n: string) => {
    await adminAPI.setActiveAI(n)
    reload()
  }

  return (
    <section className="admin-section">
      <h3>AI 분석 설정</h3>
      <p className="admin-desc">
        Pod 상세의 <strong>AI 분석</strong> 탭이 사용할 LLM 엔드포인트입니다. 여러 개를 등록해두고
        분석 시 선택할 수 있으며, <strong>기본</strong>으로 지정한 모델이 기본 선택됩니다.
        vLLM·Ollama·LiteLLM 등 OpenAI 호환 API는 <code>openai</code>, Anthropic Messages API 형식은{' '}
        <code>anthropic</code>. URL은 베이스 주소만 입력합니다 (예: <code>http://vllm.ai-infra:8000</code>).
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>형식</th>
            <th>URL / 모델</th>
            <th>기본</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.name}>
              <td>{m.name}</td>
              <td>{m.provider}</td>
              <td className="mono">
                {m.url}
                <br />
                {m.model}
                {m.hasKey ? ' · 키 설정됨' : ''}
              </td>
              <td>
                {active === m.name ? (
                  <span className="text-ok">기본</span>
                ) : (
                  <button className="link-btn" onClick={() => makeActive(m.name)}>
                    기본으로
                  </button>
                )}
              </td>
              <td className="admin-row-actions">
                <button className="link-btn" onClick={() => edit(m)}>
                  수정
                </button>
                <button className="danger" onClick={() => remove(m.name)}>
                  삭제
                </button>
              </td>
            </tr>
          ))}
          {models.length === 0 && (
            <tr>
              <td colSpan={5} className="admin-empty">
                등록된 AI 모델이 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input placeholder="이름 (예: 사내LLM-7b)" value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="openai">OpenAI 호환</option>
          <option value="anthropic">Anthropic 호환</option>
        </select>
        <input placeholder="베이스 URL" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input placeholder="모델 이름" value={model} onChange={(e) => setModel(e.target.value)} required />
        <input
          type="password"
          placeholder="API 키 (선택 — 수정 시 비우면 유지)"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="new-password"
        />
        <button type="submit">추가 / 수정</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}
