import { useEffect, useState } from 'react'
import { fetchAuthMethods, loginLocal } from '../lib/api'
import type { AuthMethods } from '../lib/types'

export function LoginPage() {
  const [methods, setMethods] = useState<AuthMethods | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchAuthMethods().then((m) => {
      // 인증이 꺼져 있거나, OIDC만 있는 경우 바로 이동
      if (!m.enabled) window.location.href = '/'
      else if (m.oidc && !m.local) window.location.href = '/auth/login'
      else setMethods(m)
    })
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await loginLocal(username, password)
    setBusy(false)
    if (res.ok) window.location.href = '/'
    else setError(res.error ?? '로그인 실패')
  }

  if (!methods) return null

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="logo login-logo">
          <span className="logo-mark">⎈</span> PodView
        </div>

        {methods.local && (
          <form onSubmit={submit} className="login-form">
            <input
              placeholder="아이디"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            <input
              type="password"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn" disabled={busy || !username || !password}>
              {busy ? '로그인 중…' : '로그인'}
            </button>
          </form>
        )}

        {methods.oidc && methods.local && <div className="login-divider">또는</div>}

        {methods.oidc && (
          <a href="/auth/login" className="login-btn sso">
            SSO(Keycloak) 로그인
          </a>
        )}
      </div>
    </div>
  )
}
