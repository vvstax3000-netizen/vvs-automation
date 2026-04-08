import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../../context/AuthContext'
import './MetaAds.css'

const TABS = [
  { key: 'overview', label: '개요' },
  { key: 'placement', label: '노출위치' },
  { key: 'demographics', label: '인구통계' },
  { key: 'region', label: '지역' },
  { key: 'actions', label: '반응' },
  { key: 'adsets', label: '광고세트' },
  { key: 'ads', label: '소재' },
]

const REGION_MAP = {
  'Gyeonggi-do': '경기도', 'Seoul': '서울', 'Incheon': '인천', 'Busan': '부산',
  'Daegu': '대구', 'Daejeon': '대전', 'Gwangju': '광주', 'Ulsan': '울산',
  'Sejong-si': '세종', 'Gangwon-do': '강원도', 'Chungcheongbuk-do': '충북',
  'Chungcheongnam-do': '충남', 'Jeollabuk-do': '전북', 'Jeollanam-do': '전남',
  'Gyeongsangbuk-do': '경북', 'Gyeongsangnam-do': '경남', 'Jeju-do': '제주',
}

const PLACEMENT_MAP = {
  'feed': '피드', 'story': '스토리', 'instagram_stories': '스토리',
  'instagram_reels': '릴스', 'instagram_explore_grid_home': '탐색',
  'an_classic': 'Audience Network', 'video_feeds': '동영상 피드',
  'right_hand_column': '우측 칸', 'marketplace': '마켓플레이스',
  'search': '검색', 'instream_video': '인스트림', 'rewarded_video': '리워드',
  'reels': '릴스', 'explore': '탐색', 'profile_feed': '프로필 피드',
}

const ACTION_ICONS = {
  'link_click': '👆', 'post_engagement': '👍', 'landing_page_view': '📄',
  'video_view': '🎬', 'post_reaction': '❤️', 'comment': '💬',
  'post': '🔗', 'onsite_conversion.post_save': '🔖', 'page_engagement': '📊',
  'photo_view': '🖼️',
}

function defaultDates() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 7)
  return { since: start.toISOString().split('T')[0], until: end.toISOString().split('T')[0] }
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
  const [activeTab, setActiveTab] = useState('overview')
  const [tabData, setTabData] = useState({})
  const [tabLoading, setTabLoading] = useState({})
  const [tabError, setTabError] = useState({})

  const { since: ds, until: du } = defaultDates()
  const [since, setSince] = useState(ds)
  const [until, setUntil] = useState(du)

  const headers = { Authorization: `Bearer ${token}` }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }
  const base = `/api/meta-ads/${selectedClientId}`
  const qs = `since=${since}&until=${until}`

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
        body: JSON.stringify({ meta_api_token: settings.meta_api_token, meta_ad_account_id: settings.meta_ad_account_id, meta_cpm: settings.meta_cpm })
      })
      alert('설정이 저장되었습니다')
    } finally { setSaving(false) }
  }

  const fetchInsights = async () => {
    if (!selectedClientId) return
    setLoading(true); setError(''); setInsights(null); setTabData({}); setTabError({})
    try {
      const res = await fetch(`${base}/insights?${qs}`, { headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setInsights(data)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    if (selectedClientId && since && until) fetchInsights()
  }, [selectedClientId])

  const fetchTab = useCallback(async (tab) => {
    if (tabData[tab] || tabLoading[tab]) return
    setTabLoading(p => ({ ...p, [tab]: true }))
    setTabError(p => ({ ...p, [tab]: null }))
    try {
      let url
      switch (tab) {
        case 'overview': {
          const [platform, device] = await Promise.all([
            fetch(`${base}/breakdowns?${qs}&type=platform`, { headers }).then(r => r.json()),
            fetch(`${base}/breakdowns?${qs}&type=device`, { headers }).then(r => r.json()),
          ])
          setTabData(p => ({ ...p, overview: { platform, device } }))
          return
        }
        case 'placement': url = `${base}/breakdowns?${qs}&type=placement`; break
        case 'demographics': url = `${base}/breakdowns?${qs}&type=age_gender`; break
        case 'region': url = `${base}/breakdowns?${qs}&type=region`; break
        case 'actions': url = `${base}/actions?${qs}`; break
        case 'adsets': url = `${base}/adsets?${qs}`; break
        case 'ads': url = `${base}/ads?${qs}`; break
      }
      const res = await fetch(url, { headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setTabData(p => ({ ...p, [tab]: data }))
    } catch (err) { setTabError(p => ({ ...p, [tab]: err.message })) }
    finally { setTabLoading(p => ({ ...p, [tab]: false })) }
  }, [selectedClientId, since, until, tabData, tabLoading])

  useEffect(() => {
    if (insights && activeTab) fetchTab(activeTab)
  }, [activeTab, insights])

  const handleTabClick = (tab) => { setActiveTab(tab); fetchTab(tab) }

  return (
    <div className="meta-page">
      <h2>메타 광고 데이터</h2>

      <div className="meta-settings-bar">
        <button onClick={() => setShowSettings(!showSettings)} className="btn">
          {showSettings ? '설정 닫기' : '설정'}
        </button>
      </div>

      {showSettings && (
        <div className="m-card m-settings-panel">
          <div className="form-row">
            <div className="form-group">
              <label>Meta API 토큰</label>
              <input type="password" value={settings.meta_api_token || ''}
                onChange={e => setSettings(s => ({ ...s, meta_api_token: e.target.value }))}
                placeholder="Access Token" />
            </div>
            <div className="form-group" style={{ maxWidth: 220 }}>
              <label>광고 계정 ID</label>
              <input value={settings.meta_ad_account_id || ''}
                onChange={e => setSettings(s => ({ ...s, meta_ad_account_id: e.target.value }))}
                placeholder="act_123456789" />
            </div>
            <div className="form-group" style={{ maxWidth: 140 }}>
              <label>마크업 CPM</label>
              <input type="number" value={settings.meta_cpm || '7000'}
                onChange={e => setSettings(s => ({ ...s, meta_cpm: e.target.value }))} />
            </div>
            <button onClick={saveSettings} className="btn btn-primary" disabled={saving}
              style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      <div className="m-controls">
        <div className="form-group">
          <label>광고주</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
            <option value="">-- 선택 --</option>
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
          disabled={loading || !selectedClientId} style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {insights && (
        <>
          <SummaryCards insights={insights} />

          <div className="m-tabs">
            {TABS.map(t => (
              <button key={t.key} className={`m-tab ${activeTab === t.key ? 'active' : ''}`}
                onClick={() => handleTabClick(t.key)}>{t.label}</button>
            ))}
          </div>

          <div className="m-tab-content">
            {tabLoading[activeTab] && <p className="m-tab-loading">데이터 로딩 중...</p>}
            {tabError[activeTab] && <div className="form-error">{tabError[activeTab]}</div>}
            {!tabLoading[activeTab] && tabData[activeTab] && (
              <>
                {activeTab === 'overview' && <OverviewTab data={tabData.overview} />}
                {activeTab === 'placement' && <PlacementTab data={tabData.placement} />}
                {activeTab === 'demographics' && <DemographicsTab data={tabData.demographics} />}
                {activeTab === 'region' && <RegionTab data={tabData.region} />}
                {activeTab === 'actions' && <ActionsTab data={tabData.actions} />}
                {activeTab === 'adsets' && <AdsetsTab data={tabData.adsets} />}
                {activeTab === 'ads' && <AdsTab data={tabData.ads} cpm={insights.cpm} />}
              </>
            )}
          </div>
        </>
      )}

      {!selectedClientId && !loading && (
        <div className="placeholder">광고주를 선택하고 기간을 설정한 뒤 조회 버튼을 눌러주세요.</div>
      )}
    </div>
  )
}

function SummaryCards({ insights }) {
  const cards = [
    { icon: '👁', label: '노출수', value: insights.impressions.toLocaleString() },
    { icon: '👥', label: '도달', value: insights.reach.toLocaleString() },
    { icon: '🔄', label: '빈도', value: insights.frequency },
    { icon: '👆', label: '클릭수', value: insights.clicks.toLocaleString() },
    { icon: '📊', label: 'CTR', value: insights.ctr + '%' },
    { icon: '💰', label: 'CPC', value: insights.cpc.toLocaleString() + '원', accent: true },
    { icon: '💳', label: '전체비용', value: insights.totalCost.toLocaleString() + '원', accent: true },
  ]
  return (
    <div className="m-summary">
      <div className="m-summary-meta">
        {insights.dateStart} ~ {insights.dateEnd}
        <span className="m-cpm-badge">CPM {Number(insights.cpm).toLocaleString()}원</span>
        {insights.campaignCount > 1 && <span className="m-cpm-badge">캠페인 {insights.campaignCount}개</span>}
      </div>
      <div className="m-summary-grid">
        {cards.map(c => (
          <div key={c.label} className={`m-card m-stat-card ${c.accent ? 'accent' : ''}`}>
            <span className="m-stat-icon">{c.icon}</span>
            <div>
              <div className="m-stat-label">{c.label}</div>
              <div className="m-stat-value">{c.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function BarChart({ items, colorFn, labelKey, valueKey }) {
  const max = Math.max(...items.map(i => i[valueKey] || 0), 1)
  const total = items.reduce((s, i) => s + (i[valueKey] || 0), 0)
  return (
    <div className="m-bar-chart">
      {items.map((item, i) => {
        const val = item[valueKey] || 0
        const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0
        return (
          <div key={i} className="m-bar-row">
            <span className="m-bar-label">{item[labelKey]}</span>
            <div className="m-bar-track">
              <div className="m-bar-fill" style={{
                width: `${(val / max) * 100}%`,
                backgroundColor: colorFn?.(item) || 'var(--meta-primary)'
              }}>
                {val > 0 && <span>{val.toLocaleString()} ({pct}%)</span>}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OverviewTab({ data }) {
  const platformColor = (item) => {
    const p = item.publisher_platform?.toLowerCase()
    if (p === 'facebook') return '#1877F2'
    if (p === 'instagram') return '#E4405F'
    if (p === 'audience_network') return '#F7981C'
    return '#6B7280'
  }
  return (
    <div>
      <h3 className="m-section-title">플랫폼별 성과</h3>
      {data.platform?.length ? (
        <BarChart items={data.platform} colorFn={platformColor}
          labelKey="publisher_platform" valueKey="impressions" />
      ) : <p className="m-empty">데이터가 없습니다.</p>}

      <h3 className="m-section-title" style={{ marginTop: 24 }}>기기별 성과</h3>
      {data.device?.length ? (
        <div className="m-device-cards">
          {data.device.map((d, i) => (
            <div key={i} className="m-card m-device-card">
              <span className="m-device-icon">{d.device_platform === 'mobile_app' || d.device_platform === 'mobile_web' ? '📱' : '🖥️'}</span>
              <div>
                <div className="m-stat-label">{d.device_platform}</div>
                <div className="m-stat-value">{d.impressions.toLocaleString()}</div>
                <div className="m-stat-sub">클릭 {d.clicks.toLocaleString()} | CTR {d.ctr}%</div>
              </div>
            </div>
          ))}
        </div>
      ) : <p className="m-empty">데이터가 없습니다.</p>}
    </div>
  )
}

function PlacementTab({ data }) {
  if (!data?.length) return <p className="m-empty">데이터가 없습니다.</p>
  const totalSpend = data.reduce((s, r) => s + r.spend, 0)
  return (
    <table className="m-table">
      <thead>
        <tr><th>플랫폼</th><th>위치</th><th>노출수</th><th>클릭수</th><th>CTR</th><th>비용 (비중)</th></tr>
      </thead>
      <tbody>
        {data.map((r, i) => {
          const pct = totalSpend > 0 ? (r.spend / totalSpend) * 100 : 0
          return (
            <tr key={i}>
              <td>{r.publisher_platform}</td>
              <td>{PLACEMENT_MAP[r.platform_position] || r.platform_position}</td>
              <td>{r.impressions.toLocaleString()}</td>
              <td>{r.clicks.toLocaleString()}</td>
              <td>{r.ctr}%</td>
              <td>
                <div className="m-spend-cell">
                  <span>${r.spend.toFixed(0)}</span>
                  <div className="m-progress-track"><div className="m-progress-fill" style={{ width: pct + '%' }} /></div>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DemographicsTab({ data }) {
  if (!data?.length) return <p className="m-empty">데이터가 없습니다.</p>
  const ages = [...new Set(data.map(d => d.age))].sort()
  const byKey = {}
  data.forEach(d => { byKey[`${d.age}|${d.gender}`] = d })
  const totalImp = data.reduce((s, d) => s + d.impressions, 0)
  let maxCtr = 0
  data.forEach(d => { const c = parseFloat(d.ctr); if (c > maxCtr) maxCtr = c })

  return (
    <table className="m-table">
      <thead>
        <tr><th>연령대</th><th>여성 노출</th><th>남성 노출</th><th>여성 클릭</th><th>남성 클릭</th><th>여성 CTR</th><th>남성 CTR</th></tr>
      </thead>
      <tbody>
        {ages.map(age => {
          const f = byKey[`${age}|female`] || {}
          const m = byKey[`${age}|male`] || {}
          const fPct = totalImp > 0 ? ((f.impressions || 0) / totalImp * 100).toFixed(1) : 0
          const mPct = totalImp > 0 ? ((m.impressions || 0) / totalImp * 100).toFixed(1) : 0
          return (
            <tr key={age}>
              <td>{age}</td>
              <td>{(f.impressions || 0).toLocaleString()} <small>({fPct}%)</small></td>
              <td>{(m.impressions || 0).toLocaleString()} <small>({mPct}%)</small></td>
              <td>{(f.clicks || 0).toLocaleString()}</td>
              <td>{(m.clicks || 0).toLocaleString()}</td>
              <td className={parseFloat(f.ctr) >= maxCtr && maxCtr > 0 ? 'm-highlight' : ''}>{f.ctr || '0.00'}%</td>
              <td className={parseFloat(m.ctr) >= maxCtr && maxCtr > 0 ? 'm-highlight' : ''}>{m.ctr || '0.00'}%</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RegionTab({ data }) {
  if (!data?.length) return <p className="m-empty">데이터가 없습니다.</p>
  return (
    <table className="m-table">
      <thead><tr><th>지역</th><th>노출수</th><th>클릭수</th><th>CTR</th><th>비용</th></tr></thead>
      <tbody>
        {data.map((r, i) => (
          <tr key={i}>
            <td>{REGION_MAP[r.region] || r.region}</td>
            <td>{r.impressions.toLocaleString()}</td>
            <td>{r.clicks.toLocaleString()}</td>
            <td>{r.ctr}%</td>
            <td>${r.spend.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ActionsTab({ data }) {
  if (!data?.actions?.length) return <p className="m-empty">반응 데이터가 없습니다.</p>
  const maxVal = Math.max(...data.actions.map(a => a.value))
  return (
    <div className="m-action-grid">
      {data.actions.map(a => (
        <div key={a.type} className={`m-card m-action-card ${a.value === maxVal ? 'highlight' : ''}`}>
          <span className="m-action-icon">{ACTION_ICONS[a.type] || '📌'}</span>
          <div className="m-action-value">{a.value.toLocaleString()}</div>
          <div className="m-action-label">{a.label}</div>
        </div>
      ))}
    </div>
  )
}

function AdsetsTab({ data }) {
  if (!data?.length) return <p className="m-empty">광고세트 데이터가 없습니다.</p>
  return (
    <table className="m-table">
      <thead><tr><th>광고세트명</th><th>상태</th><th>노출수</th><th>클릭수</th><th>CTR</th><th>비용</th></tr></thead>
      <tbody>
        {data.map(as => (
          <tr key={as.id}>
            <td>{as.name}</td>
            <td>{as.status === 'ACTIVE' ? '🟢' : '⏸️'} {as.status}</td>
            <td>{as.impressions.toLocaleString()}</td>
            <td>{as.clicks.toLocaleString()}</td>
            <td>{as.ctr}%</td>
            <td>${as.spend.toFixed(0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function AdsTab({ data, cpm }) {
  if (!data?.length) return <p className="m-empty">소재 데이터가 없습니다.</p>
  return (
    <div className="m-ads-grid">
      {data.map(ad => (
        <div key={ad.id} className="m-card m-ad-card">
          {ad.thumbnailUrl ? (
            <img src={ad.thumbnailUrl} alt="" className="m-ad-thumb" />
          ) : (
            <div className="m-ad-thumb m-ad-thumb-empty" />
          )}
          <div className="m-ad-info">
            <div className="m-ad-name">{ad.name}</div>
            <div className="m-ad-status">{ad.status === 'ACTIVE' ? '🟢 활성' : '⏸️ 비활성'}</div>
            <div className="m-ad-stats">
              <span>노출 {ad.impressions.toLocaleString()}</span>
              <span>클릭 {ad.clicks.toLocaleString()}</span>
              <span>CTR {ad.ctr}%</span>
            </div>
            {ad.engagement > 0 && <div className="m-ad-engagement">게시물참여 {ad.engagement.toLocaleString()}</div>}
          </div>
        </div>
      ))}
    </div>
  )
}
