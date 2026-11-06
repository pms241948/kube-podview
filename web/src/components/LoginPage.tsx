import { useEffect, useState } from 'react'
import { fetchAuthMethods, loginLocal } from '../lib/api'
import type { AuthMethods } from '../lib/types'
import { LanguageSelect, useI18n } from '../lib/i18n'

export function LoginPage() {
  const { t } = useI18n()
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
    else setError(res.error ?? t('login.failed'))
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
              placeholder={t('login.username')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
            <input
              type="password"
              placeholder={t('login.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-btn" disabled={busy || !username || !password}>
              {busy ? t('login.busy') : t('login.submit')}
            </button>
          </form>
        )}

        {methods.oidc && methods.local && <div className="login-divider">{t('login.or')}</div>}

        {methods.oidc && (
          <a href="/auth/login" className="login-btn sso">
            {t('login.sso')}
          </a>
        )}

        {/* 로그인 전에도 언어를 바꿀 수 있도록 */}
        <LanguageSelect className="login-lang" />
      </div>
    </div>
  )
}
