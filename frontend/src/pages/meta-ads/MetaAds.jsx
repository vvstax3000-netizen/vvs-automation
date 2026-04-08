import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import './MetaAds.css'

function defaultDates() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 7)
  return {
    since: start.toISOString().split('T')[0],
    until: end.toISOString().split('T')[0]
  }
}

export default function MetaAds() {
  const { token } = useAuth()
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [settings, setSettings] = useState({ meta_api_token: '', meta_ad_account_id: '', meta_cpm: '7000' })
  const [showSettings, setShowSettings] = useState(false)
  const [saving, setSaving] = useState(false)
  const [insights, setInsights] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { since: defaultSince, until: defaultUntil } = defaultDates()
  const [since, setSince] = useState(defaultSince)
  const [until, setUntil] = useState(defaultUntil)

  const headers = { Authorization: `Bearer ${token}` }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }

  useEffect(() => {
    Promise.all([
      fetch('/api/clients', { headers }).then(r => r.json()),
      fetch('/api/settings', { headers }).then(r => r.json())
    ]).then(([c, s]) => {
      setClients(c)
      setSettings(prev => ({ ...prev, ...s }))
      if (!s.meta_api_token) setShowSettings(true)
    }).catch(console.error)
  }, [])

  const saveSettings = async () => {
    setSaving(true)
    try {
      await fetch('/api/settings', {
        method: 'PUT', headers: jsonHeaders,
        body: JSON.stringify({
          meta_api_token: settings.meta_api_token,
          meta_ad_account_id: settings.meta_ad_account_id,
          meta_cpm: settings.meta_cpm
        })
      })
      alert('설정이 저장되었습니다')
    } finally {
      setSaving(false)
    }
  }

  const fetchInsights = async () => {
    if (!selectedClientId || !since || !until) return
    setLoading(true)
    setError('')
    setInsights(null)
    try {
      const res = await fetch(
        `/api/meta-ads/${selectedClientId}/insights?since=${since}&until=${until}`,
        { headers }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInsights(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedClientId && since && until) fetchInsights()
  }, [selectedClientId])

  return (
    <div className="page">
      <h2>메타 광고 데이터</h2>

      {/* Settings */}
      <div className="meta-settings-bar">
        <button onClick={() => setShowSettings(!showSettings)} className="btn">
          {showSettings ? '설정 닫기' : '설정'}
        </button>
      </div>

      {showSettings && (
        <div className="meta-settings-panel">
          <div className="form-row">
            <div className="form-group">
              <label>Meta API 토큰</label>
              <input
                type="password"
                value={settings.meta_api_token || ''}
                onChange={e => setSettings(s => ({ ...s, meta_api_token: e.target.value }))}
                placeholder="Meta Marketing API Access Token"
              />
            </div>
            <div className="form-group" style={{ maxWidth: 250 }}>
              <label>광고 계정 ID</label>
              <input
                value={settings.meta_ad_account_id || ''}
                onChange={e => setSettings(s => ({ ...s, meta_ad_account_id: e.target.value }))}
                placeholder="act_123456789"
              />
            </div>
            <div className="form-group" style={{ maxWidth: 160 }}>
              <label>마크업 CPM (원)</label>
              <input
                type="number"
                value={settings.meta_cpm || '7000'}
                onChange={e => setSettings(s => ({ ...s, meta_cpm: e.target.value }))}
              />
            </div>
            <button onClick={saveSettings} className="btn btn-primary" disabled={saving}
              style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
              {saving ? '저장 중...' : '설정 저장'}
            </button>
          </div>
          <p className="field-hint">광고 계정 ID는 전체 비즈니스 매니저의 계정 ID입니다. 광고주별 캠페인 ID는 광고주 관리에서 설정합니다.</p>
        </div>
      )}

      {/* Controls */}
      <div className="meta-controls">
        <div className="form-group">
          <label>광고주</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
            <option value="">-- 광고주를 선택하세요 --</option>
            {clients.filter(c => c.meta_campaign_ids).map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label>시작일</label>
          <input type="date" value={since} onChange={e => setSince(e.target.value)} />
        </div>
        <div className="form-group">
          <label>종료일</label>
          <input type="date" value={until} onChange={e => setUntil(e.target.value)} />
        </div>
        <button onClick={fetchInsights} className="btn btn-primary"
          disabled={loading || !selectedClientId}
          style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      {/* Error */}
      {error && <div className="form-error">{error}</div>}

      {/* Insights */}
      {insights && (
        <div className="meta-insights">
          <p className="insights-period">
            {insights.dateStart} ~ {insights.dateEnd}
            <span className="insights-cpm">적용 CPM: {Number(insights.cpm).toLocaleString()}원</span>
            {insights.campaignCount > 1 && <span className="insights-cpm">캠페인 {insights.campaignCount}개 합산</span>}
          </p>
          <div className="insights-grid">
            <div className="insight-card">
              <span className="insight-label">노출수</span>
              <span className="insight-value">{insights.impressions.toLocaleString()}</span>
            </div>
            <div className="insight-card">
              <span className="insight-label">도달</span>
              <span className="insight-value">{insights.reach.toLocaleString()}</span>
            </div>
            <div className="insight-card">
              <span className="insight-label">빈도</span>
              <span className="insight-value">{insights.frequency}</span>
            </div>
            <div className="insight-card">
              <span className="insight-label">클릭수</span>
              <span className="insight-value">{insights.clicks.toLocaleString()}</span>
            </div>
            <div className="insight-card">
              <span className="insight-label">클릭률 (CTR)</span>
              <span className="insight-value">{insights.ctr}%</span>
            </div>
            <div className="insight-card accent">
              <span className="insight-label">클릭당비용 (CPC)</span>
              <span className="insight-value">{insights.cpc.toLocaleString()}원</span>
            </div>
            <div className="insight-card accent">
              <span className="insight-label">전체비용</span>
              <span className="insight-value">{insights.totalCost.toLocaleString()}원</span>
            </div>
          </div>
        </div>
      )}

      {!selectedClientId && !loading && (
        <div className="placeholder">광고주를 선택하고 기간을 설정한 뒤 조회 버튼을 눌러주세요.</div>
      )}
    </div>
  )
}
