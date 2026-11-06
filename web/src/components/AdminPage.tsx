import { useEffect, useState } from 'react'
import { LanguageSelect, rich, useI18n } from '../lib/i18n'
import { adminAPI, type AdminAIModel, type AdminCluster, type AdminOIDCUser, type AdminUser } from '../lib/api'

interface Props {
  isAdmin: boolean
  onClose: () => void
  onClustersChanged: () => void
}

/** 설정: 모든 사용자에게 일반(언어) 설정, admin에게는 클러스터·사용자·AI 관리도 보여준다 */
export function AdminPage({ isAdmin, onClose, onClustersChanged }: Props) {
  const { t } = useI18n()
  return (
    <div className="admin-page">
      <div className="admin-head">
        <h2>{t('settings.title')}</h2>
        <button className="close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="admin-body">
        <GeneralSection />
        {isAdmin && (
          <>
            <ClusterSection onChanged={onClustersChanged} />
            <UserSection />
            <OIDCUserSection />
            <AISection />
          </>
        )}
      </div>
    </div>
  )
}

function GeneralSection() {
  const { t } = useI18n()
  return (
    <section className="admin-section">
      <h3>{t('settings.general')}</h3>
      <div className="admin-form settings-row">
        <label htmlFor="settings-lang">{t('settings.language')}</label>
        <LanguageSelect id="settings-lang" className="settings-lang" />
      </div>
      <p className="admin-desc">{t('settings.languageDesc')}</p>
    </section>
  )
}

function ClusterSection({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n()
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
      setMsg(res.error ?? t('common.saveFailed'))
      return
    }
    setName('')
    setUrl('')
    setToken('')
    reload()
    onChanged()
  }

  const remove = async (n: string) => {
    if (!confirm(t('admin.cluster.confirmDelete', { name: n }))) return
    await adminAPI.deleteCluster(n)
    reload()
    onChanged()
  }

  return (
    <section className="admin-section">
      <h3>{t('admin.cluster.title')}</h3>
      <p className="admin-desc">{rich(t('admin.cluster.desc'), { code: <code>GATEWAY_TOKEN</code> })}</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t('admin.name')}</th>
            <th>URL</th>
            <th>{t('admin.token')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {clusters.map((c) => (
            <tr key={c.name}>
              <td>{c.name}</td>
              <td className="mono">{c.url}</td>
              <td>{c.hasToken ? t('admin.tokenSet') : '—'}</td>
              <td>
                <button className="danger" onClick={() => remove(c.name)}>
                  {t('common.delete')}
                </button>
              </td>
            </tr>
          ))}
          {clusters.length === 0 && (
            <tr>
              <td colSpan={4} className="admin-empty">
                {t('admin.cluster.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input placeholder={t('admin.cluster.namePh')} value={name} onChange={(e) => setName(e.target.value)} required />
        <input placeholder={t('admin.cluster.urlPh')} value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input placeholder={t('admin.cluster.tokenPh')} value={token} onChange={(e) => setToken(e.target.value)} />
        <button type="submit">{t('common.addOrUpdate')}</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}

function UserSection() {
  const { t } = useI18n()
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
      setMsg(res.error ?? t('common.saveFailed'))
      return
    }
    setUsername('')
    setPassword('')
    setRole('viewer')
    reload()
  }

  const remove = async (u: string) => {
    if (!confirm(t('admin.users.confirmDelete', { name: u }))) return
    await adminAPI.deleteUser(u)
    reload()
  }

  return (
    <section className="admin-section">
      <h3>{t('admin.users.title')}</h3>
      <p className="admin-desc">{rich(t('admin.users.desc'), { code: <code>LOCAL_USERS</code> })}</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t('admin.users.username')}</th>
            <th>{t('admin.role')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.username}>
              <td>{u.username}</td>
              <td>{t(u.role === 'admin' ? 'role.admin' : 'role.viewer')}</td>
              <td>
                <button className="danger" onClick={() => remove(u.username)}>
                  {t('common.delete')}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={3} className="admin-empty">
                {t('admin.users.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input placeholder={t('admin.users.username')} value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
        <input
          type="password"
          placeholder={t('admin.users.passwordPh')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">{t('role.viewer')}</option>
          <option value="admin">{t('role.admin')}</option>
        </select>
        <button type="submit">{t('common.addOrUpdate')}</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}

function OIDCUserSection() {
  const { t } = useI18n()
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
      setMsg(res.error ?? t('common.saveFailed'))
      return
    }
    setEmail('')
    setRole('viewer')
    reload()
  }

  const remove = async (em: string) => {
    if (!confirm(t('admin.oidc.confirmDelete', { name: em }))) return
    await adminAPI.deleteOIDCUser(em)
    reload()
  }

  return (
    <section className="admin-section">
      <h3>{t('admin.oidc.title')}</h3>
      <p className="admin-desc">{rich(t('admin.oidc.desc'), { code: <code>OIDC_ADMIN_EMAILS</code> })}</p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t('admin.email')}</th>
            <th>{t('admin.role')}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.email}>
              <td className="mono">{u.email}</td>
              <td>{t(u.role === 'admin' ? 'role.admin' : 'role.viewer')}</td>
              <td>
                <button className="danger" onClick={() => remove(u.email)}>
                  {t('common.delete')}
                </button>
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={3} className="admin-empty">
                {t('admin.oidc.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input
          type="email"
          placeholder={t('admin.oidc.emailPh')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="viewer">{t('role.viewer')}</option>
          <option value="admin">{t('role.admin')}</option>
        </select>
        <button type="submit">{t('common.addOrUpdate')}</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}

function AISection() {
  const { t } = useI18n()
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
      setMsg(res.error ?? t('common.saveFailed'))
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
    if (!confirm(t('admin.ai.confirmDelete', { name: n }))) return
    await adminAPI.deleteAI(n)
    reload()
  }

  const makeActive = async (n: string) => {
    await adminAPI.setActiveAI(n)
    reload()
  }

  return (
    <section className="admin-section">
      <h3>{t('admin.ai.title')}</h3>
      <p className="admin-desc">
        {rich(t('admin.ai.desc'), {
          openai: <code>openai</code>,
          anthropic: <code>anthropic</code>,
          example: <code>http://vllm.ai-infra:8000</code>,
        })}
      </p>
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t('admin.name')}</th>
            <th>{t('admin.ai.provider')}</th>
            <th>{t('admin.ai.urlModel')}</th>
            <th>{t('admin.ai.default')}</th>
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
                {m.hasKey ? t('admin.ai.keySet') : ''}
              </td>
              <td>
                {active === m.name ? (
                  <span className="text-ok">{t('admin.ai.default')}</span>
                ) : (
                  <button className="link-btn" onClick={() => makeActive(m.name)}>
                    {t('admin.ai.makeDefault')}
                  </button>
                )}
              </td>
              <td className="admin-row-actions">
                <button className="link-btn" onClick={() => edit(m)}>
                  {t('common.edit')}
                </button>
                <button className="danger" onClick={() => remove(m.name)}>
                  {t('common.delete')}
                </button>
              </td>
            </tr>
          ))}
          {models.length === 0 && (
            <tr>
              <td colSpan={5} className="admin-empty">
                {t('admin.ai.empty')}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <input placeholder={t('admin.ai.namePh')} value={name} onChange={(e) => setName(e.target.value)} required />
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="openai">{t('admin.ai.openai')}</option>
          <option value="anthropic">{t('admin.ai.anthropic')}</option>
        </select>
        <input placeholder={t('admin.ai.urlPh')} value={url} onChange={(e) => setUrl(e.target.value)} required />
        <input placeholder={t('admin.ai.modelPh')} value={model} onChange={(e) => setModel(e.target.value)} required />
        <input
          type="password"
          placeholder={t('admin.ai.keyPh')}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          autoComplete="new-password"
        />
        <button type="submit">{t('common.addOrUpdate')}</button>
      </form>
      {msg && <div className="admin-error">{msg}</div>}
    </section>
  )
}
