import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import './NaverAds.css'

const TYPE_ORDER = ['place', 'smb', 'powerlink', 'powercontents', 'shopping', 'other']
const TYPE_NAMES = {
  place: '플레이스', smb: '소상공인', powerlink: '파워링크',
  powercontents: '파워컨텐츠', shopping: '쇼핑검색', other: '기타'
}

function defaultDates() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 7)
  return { since: start.toISOString().split('T')[0], until: end.toISOString().split('T')[0] }
}

export default function NaverAds() {
  const { token } = useAuth()
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expandedCampaigns, setExpandedCampaigns] = useState({})
  const [expandedTypes, setExpandedTypes] = useState({})

  const { since: ds, until: du } = defaultDates()
  const [since, setSince] = useState(ds)
  const [until, setUntil] = useState(du)

  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    fetch('/api/clients', { headers }).then(r => r.json()).then(setClients).catch(console.error)
  }, [])

  const fetchData = async () => {
    if (!selectedClientId) return
    setLoading(true); setError(''); setData(null)
    setExpandedCampaigns({}); setExpandedTypes({})
    try {
      const res = await fetch(
        `/api/naver-ads/${selectedClientId}/insights?since=${since}&until=${until}`, { headers })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      setData(result)
      // Auto-expand types that have data
      const autoExpand = {}
      TYPE_ORDER.forEach(t => {
        if (result.summary?.byType?.[t]?.impressions > 0) autoExpand[t] = true
      })
      setExpandedTypes(autoExpand)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { if (selectedClientId) fetchData() }, [selectedClientId])

  const toggleType = (type) => setExpandedTypes(p => ({ ...p, [type]: !p[type] }))
  const toggleCampaign = (id) => setExpandedCampaigns(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="page naver-page">
      <h2>네이버 검색광고 데이터</h2>

      <div className="naver-controls">
        <div className="form-group">
          <label>광고주</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
            <option value="">-- 광고주를 선택하세요 --</option>
            {clients.filter(c => c.naver_customer_id).map(c => (
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
        <button onClick={fetchData} className="btn btn-primary"
          disabled={loading || !selectedClientId}
          style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      {error && <div className="form-error">{error}</div>}

      {data && (
        <>
          {/* Total Summary */}
          <div className="n-total-card">
            <h3>전체 광고 성과</h3>
            <div className="n-total-grid">
              <div className="n-total-item">
                <span className="n-total-label">👁 노출수</span>
                <span className="n-total-value">{data.summary.total.impressions?.toLocaleString()}</span>
              </div>
              <div className="n-total-item">
                <span className="n-total-label">👆 클릭수</span>
                <span className="n-total-value">{data.summary.total.clicks?.toLocaleString()}</span>
              </div>
              <div className="n-total-item">
                <span className="n-total-label">📊 CTR</span>
                <span className="n-total-value">{data.summary.total.ctr}%</span>
              </div>
              <div className="n-total-item">
                <span className="n-total-label">💰 CPC</span>
                <span className="n-total-value">{data.summary.total.cpc?.toLocaleString()}원</span>
              </div>
              <div className="n-total-item accent">
                <span className="n-total-label">💳 총 광고비</span>
                <span className="n-total-value">{data.summary.total.cost?.toLocaleString()}원</span>
              </div>
            </div>
            <div className="n-total-meta">캠페인 {data.campaigns?.length || 0}개</div>
          </div>

          {/* Type Summary Cards */}
          <div className="n-type-summary-grid">
            {TYPE_ORDER.filter(t => data.summary.byType[t]).map(t => {
              const d = data.summary.byType[t]
              return (
                <div key={t} className={`n-type-summary-card n-type-bg-${t}`}>
                  <div className="n-type-summary-header">
                    <span className={`n-type-badge n-type-${t}`}>{d.typeName}</span>
                    <span className="n-type-summary-count">{d.campaignCount}개</span>
                  </div>
                  <div className="n-type-summary-stats">
                    <div>노출 <strong>{d.impressions.toLocaleString()}</strong></div>
                    <div>클릭 <strong>{d.clicks.toLocaleString()}</strong></div>
                    <div>비용 <strong>{d.cost.toLocaleString()}원</strong></div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Top Creatives by Type */}
          {data.topCreatives && TYPE_ORDER
            .filter(t => data.topCreatives[t]?.length > 0)
            .map(t => (
              <div key={t} className="n-creatives-section">
                <h3><span className={`n-type-badge n-type-${t}`}>{TYPE_NAMES[t]}</span> 상위 소재 Top 3</h3>
                <table className="data-table creative-table">
                  <thead>
                    <tr><th>#</th><th>소재</th><th>노출수</th><th>클릭수</th><th>CTR</th></tr>
                  </thead>
                  <tbody>
                    {data.topCreatives[t].map((c, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="creative-cell">
                          <div className="creative-thumbs">
                            {c.images?.length ? c.images.map((img, j) => (
                              <img key={j} src={img} alt="" className="creative-thumb" />
                            )) : <div className="creative-thumb creative-thumb-empty" />}
                          </div>
                          <span>{c.name}</span>
                        </td>
                        <td>{c.impressions.toLocaleString()}</td>
                        <td>{c.clicks.toLocaleString()}</td>
                        <td>{c.ctr}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))
          }

          {/* Campaign Accordion by Type */}
          {TYPE_ORDER.filter(t => data.campaigns.some(c => c.type === t)).map(type => {
            const camps = data.campaigns.filter(c => c.type === type)
            const isOpen = expandedTypes[type]
            const bt = data.summary.byType[type]
            return (
              <div key={type} className="n-accordion">
                <div className={`n-accordion-header ${isOpen ? 'open' : ''}`} onClick={() => toggleType(type)}>
                  <div className="n-accordion-left">
                    <span className="n-accordion-arrow">{isOpen ? '▼' : '▶'}</span>
                    <span className={`n-type-badge n-type-${type}`}>{TYPE_NAMES[type]}</span>
                    <span className="n-accordion-count">{camps.length}개 캠페인</span>
                  </div>
                  {bt && (
                    <div className="n-accordion-summary">
                      노출 {bt.impressions.toLocaleString()} | 클릭 {bt.clicks.toLocaleString()} | 비용 {bt.cost.toLocaleString()}원
                    </div>
                  )}
                </div>
                {isOpen && (
                  <div className="n-accordion-body">
                    <table className="n-camp-table">
                      <thead>
                        <tr>
                          <th className="n-col-expand"></th>
                          <th className="n-col-name">캠페인명</th>
                          <th>노출수</th><th>클릭수</th><th>CTR</th><th>CPC</th><th>비용</th>
                        </tr>
                      </thead>
                      <tbody>
                        {camps.map(camp => (
                          <CampaignRows key={camp.id} camp={camp}
                            expanded={expandedCampaigns[camp.id]}
                            onToggle={() => toggleCampaign(camp.id)} />
                        ))}
                        {/* Subtotal */}
                        <tr className="n-subtotal-row">
                          <td></td>
                          <td>소계</td>
                          <td>{bt.impressions.toLocaleString()}</td>
                          <td>{bt.clicks.toLocaleString()}</td>
                          <td>{bt.ctr}%</td>
                          <td>{bt.cpc.toLocaleString()}원</td>
                          <td>{bt.cost.toLocaleString()}원</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}

        </>
      )}

      {!selectedClientId && !loading && (
        <div className="placeholder">광고주를 선택하고 기간을 설정한 뒤 조회 버튼을 눌러주세요.</div>
      )}
    </div>
  )
}

function CampaignRows({ camp, expanded, onToggle }) {
  const hasGroups = camp.groups?.length > 0
  const statusIcon = camp.status === 'ELIGIBLE' ? '🟢' : camp.status === 'PAUSED' ? '⏸️' : '🔴'
  return (
    <>
      <tr className="n-camp-row" onClick={hasGroups ? onToggle : undefined}
        style={{ cursor: hasGroups ? 'pointer' : 'default' }}>
        <td className="n-col-expand">
          {hasGroups && <span className="n-expand-icon">{expanded ? '▼' : '▶'}</span>}
        </td>
        <td>
          <span className="n-camp-status">{statusIcon}</span>
          <span className="n-camp-name">{camp.name}</span>
        </td>
        <td>{camp.impressions.toLocaleString()}</td>
        <td>{camp.clicks.toLocaleString()}</td>
        <td>{camp.ctr}%</td>
        <td>{camp.cpc.toLocaleString()}원</td>
        <td className="n-cost-cell">{camp.cost.toLocaleString()}원</td>
      </tr>
      {expanded && camp.groups?.map(g => (
        <tr key={g.id} className="n-group-row">
          <td></td>
          <td><span className="n-group-name">└ {g.name}</span></td>
          <td>{g.impressions.toLocaleString()}</td>
          <td>{g.clicks.toLocaleString()}</td>
          <td>{g.ctr}%</td>
          <td>{g.cpc.toLocaleString()}원</td>
          <td>{g.cost.toLocaleString()}원</td>
        </tr>
      ))}
    </>
  )
}
