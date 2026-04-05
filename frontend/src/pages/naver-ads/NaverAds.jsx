import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import './NaverAds.css'

const TYPE_LABELS = {
  place: '플레이스 광고',
  powerlink: '파워링크 광고',
  smb: '소상공인 광고',
  other: '기타 광고',
  shopping: '쇼핑검색 광고',
  powercontents: '파워컨텐츠 광고'
}

const DISPLAY_ORDER = ['place', 'powerlink', 'smb', 'shopping', 'powercontents', 'other']

function defaultDates() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 7)
  return {
    since: start.toISOString().split('T')[0],
    until: end.toISOString().split('T')[0]
  }
}

export default function NaverAds() {
  const { token } = useAuth()
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const { since: defaultSince, until: defaultUntil } = defaultDates()
  const [since, setSince] = useState(defaultSince)
  const [until, setUntil] = useState(defaultUntil)

  const headers = { Authorization: `Bearer ${token}` }

  useEffect(() => {
    fetch('/api/clients', { headers })
      .then(r => r.json())
      .then(setClients)
      .catch(console.error)
  }, [])

  const fetchData = async () => {
    if (!selectedClientId || !since || !until) return
    setLoading(true)
    setError('')
    setData(null)
    try {
      const res = await fetch(
        `/api/naver-ads/${selectedClientId}/insights?since=${since}&until=${until}`,
        { headers }
      )
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      setData(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (selectedClientId && since && until) fetchData()
  }, [selectedClientId])

  // Filter clients that have all 3 Naver API fields
  const naverClients = clients.filter(c => c.naver_customer_id)
  const types = data ? DISPLAY_ORDER.filter(type => data[type]) : []

  return (
    <div className="page">
      <h2>네이버 검색광고 데이터</h2>

      {/* Controls */}
      <div className="naver-controls">
        <div className="form-group">
          <label>광고주</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
            <option value="">-- 광고주를 선택하세요 --</option>
            {naverClients.map(c => (
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

      {/* Error */}
      {error && <div className="form-error">{error}</div>}

      {/* Results */}
      {data && types.length === 0 && (
        <div className="placeholder">해당 기간에 광고 데이터가 없습니다.</div>
      )}

      {types.map(type => {
        const d = data[type]
        return (
          <div key={type} className="ad-type-section">
            <h3>{TYPE_LABELS[type] || type}</h3>
            <div className="ad-stats-grid">
              <div className="ad-stat-card">
                <span className="ad-stat-label">노출수</span>
                <span className="ad-stat-value">{d.impressions.toLocaleString()}</span>
              </div>
              <div className="ad-stat-card">
                <span className="ad-stat-label">클릭수</span>
                <span className="ad-stat-value">{d.clicks.toLocaleString()}</span>
              </div>
              <div className="ad-stat-card">
                <span className="ad-stat-label">CTR</span>
                <span className="ad-stat-value">{d.ctr}%</span>
              </div>
              <div className="ad-stat-card">
                <span className="ad-stat-label">CPC</span>
                <span className="ad-stat-value">{d.cpc.toLocaleString()}원</span>
              </div>
              <div className="ad-stat-card accent">
                <span className="ad-stat-label">총 광고비</span>
                <span className="ad-stat-value">{d.totalCost.toLocaleString()}원</span>
              </div>
            </div>

            {d.topCreatives?.length > 0 && (
              <div className="top-creatives">
                <h4>상위 소재 Top 3</h4>
                <table className="data-table creative-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>소재</th>
                      <th>노출수</th>
                      <th>클릭수</th>
                      <th>CTR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.topCreatives.map((c, i) => (
                      <tr key={i}>
                        <td>{i + 1}</td>
                        <td className="creative-cell">
                          <div className="creative-thumbs">
                            {c.images?.length ? c.images.map((img, j) => (
                              <img key={j} src={img} alt="" className="creative-thumb" />
                            )) : (
                              <div className="creative-thumb creative-thumb-empty" />
                            )}
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
            )}
          </div>
        )
      })}

      {!selectedClientId && !loading && (
        <div className="placeholder">광고주를 선택하고 기간을 설정한 뒤 조회 버튼을 눌러주세요.</div>
      )}
    </div>
  )
}
