import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import './Reports.css'

const TABS = [
  { key: 'create', label: '보고서 생성' },
  { key: 'list', label: '보고서 목록' }
]

function defaultPeriod() {
  const today = new Date()
  const day = today.getDay()
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((day + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0]
  }
}

const fmt = (n) => Number(n || 0).toLocaleString()
const fmtDate = (s) => {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${parseInt(m)}.${parseInt(d)}`
}

export default function Reports() {
  const { token } = useAuth()
  const [tab, setTab] = useState('create')
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [reports, setReports] = useState([])
  const [currentReport, setCurrentReport] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')

  const { start: defStart, end: defEnd } = defaultPeriod()
  const [periodStart, setPeriodStart] = useState(defStart)
  const [periodEnd, setPeriodEnd] = useState(defEnd)
  const [periodType, setPeriodType] = useState('weekly')

  const headers = { Authorization: `Bearer ${token}` }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }

  useEffect(() => {
    fetch('/api/clients', { headers })
      .then(r => r.json()).then(setClients).catch(console.error)
  }, [])

  useEffect(() => {
    if (!selectedClientId) { setReports([]); return }
    fetch(`/api/reports/${selectedClientId}`, { headers })
      .then(r => r.json()).then(d => setReports(d.reports || []))
  }, [selectedClientId, currentReport])

  const generateReport = async () => {
    if (!selectedClientId) return setError('광고주를 선택해주세요')
    setError('')
    setGenerating(true)
    setCurrentReport(null)
    try {
      const res = await fetch(`/api/reports/${selectedClientId}/generate`, {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ periodStart, periodEnd, periodType })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCurrentReport(data.report)
    } catch (err) { setError(err.message) }
    finally { setGenerating(false) }
  }

  const viewReport = async (id) => {
    const res = await fetch(`/api/reports/${selectedClientId}/${id}`, { headers })
    if (res.ok) {
      const data = await res.json()
      setCurrentReport(data.report)
      setTab('create')
    }
  }

  const deleteReport = async (id) => {
    if (!confirm('보고서를 삭제하시겠습니까?')) return
    await fetch(`/api/reports/${selectedClientId}/${id}`, { method: 'DELETE', headers })
    setReports(reports.filter(r => r.id !== id))
    if (currentReport?.id === id) setCurrentReport(null)
  }

  const updateReport = async (fields) => {
    if (!currentReport) return
    const res = await fetch(`/api/reports/${selectedClientId}/${currentReport.id}`, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify(fields)
    })
    if (res.ok) {
      const data = await res.json()
      setCurrentReport(data.report)
    }
  }

  const exportNotion = () => {
    alert('노션 내보내기는 준비 중입니다.')
  }

  return (
    <div className="page reports-page">
      <h2>보고서 관리</h2>

      <div className="r-tabs">
        {TABS.map(t => (
          <button key={t.key} className={`r-tab ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'create' && (
        <>
          <div className="r-form-card">
            <div className="r-form-row">
              <div className="form-group">
                <label>광고주</label>
                <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
                  <option value="">-- 선택 --</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>{c.company_name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>시작일</label>
                <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} />
              </div>
              <div className="form-group">
                <label>종료일</label>
                <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} />
              </div>
              <div className="form-group">
                <label>유형</label>
                <select value={periodType} onChange={e => setPeriodType(e.target.value)}>
                  <option value="weekly">주간</option>
                  <option value="monthly">월간</option>
                </select>
              </div>
              <button onClick={generateReport} className="btn btn-primary"
                disabled={generating || !selectedClientId}
                style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
                {generating ? '생성 중...' : '보고서 생성'}
              </button>
            </div>

            {error && <div className="form-error">{error}</div>}
            {generating && (
              <div className="r-progress">
                <div className="r-progress-bar"><div className="r-progress-fill" /></div>
                <p>데이터 수집 중... (네이버/메타 API 호출)</p>
              </div>
            )}
          </div>

          {currentReport && (
            <ReportPreview report={currentReport} onUpdate={updateReport} onExport={exportNotion} />
          )}
        </>
      )}

      {tab === 'list' && (
        <div>
          <div className="r-form-card">
            <div className="form-group" style={{ maxWidth: 320 }}>
              <label>광고주</label>
              <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
                <option value="">-- 선택 --</option>
                {clients.map(c => (
                  <option key={c.id} value={c.id}>{c.company_name}</option>
                ))}
              </select>
            </div>
          </div>

          {reports.length === 0 ? (
            <div className="placeholder">{selectedClientId ? '저장된 보고서가 없습니다.' : '광고주를 선택해주세요.'}</div>
          ) : (
            <div className="r-list">
              {reports.map(r => (
                <div key={r.id} className="r-list-card">
                  <div className="r-list-period">
                    📅 {fmtDate(r.period_start)} ~ {fmtDate(r.period_end)} ({r.period_type === 'weekly' ? '주간' : '월간'})
                    <span className="r-list-date">{r.created_at?.split(' ')[0]} 생성</span>
                  </div>
                  <div className="r-list-summary">
                    매출 {fmt(Math.round(r.revenue / 1000))}천원 |
                    방문객 {fmt(r.visitors)}팀 |
                    ROAS {Number(r.roas || 0).toFixed(0)}%
                  </div>
                  <div className="r-list-actions">
                    <button onClick={() => viewReport(r.id)} className="btn btn-sm btn-primary">보기</button>
                    <button onClick={exportNotion} className="btn btn-sm">노션 내보내기</button>
                    <button onClick={() => deleteReport(r.id)} className="btn btn-sm btn-danger">삭제</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReportPreview({ report, onUpdate, onExport }) {
  const [imgIdx, setImgIdx] = useState(null)
  const r = report

  const dashboard = [
    { icon: '🔍', label: '플레이스 유입', value: fmt(r.place_views) + '회', cls: 'r-c-views' },
    { icon: '👥', label: '방문객', value: fmt(r.visitors) + '팀', cls: 'r-c-visitors' },
    { icon: '📈', label: '전환율', value: Number(r.conversion_rate || 0).toFixed(2) + '%', cls: 'r-c-conv' },
    { icon: '💰', label: '매출', value: fmt(Math.round(r.revenue / 1000)) + '천원', cls: 'r-c-revenue' },
    { icon: '📊', label: '객단가', value: fmt(r.unit_price) + '원', cls: 'r-c-unit' },
    { icon: '💳', label: '광고비', value: fmt(r.total_ad_cost) + '원', cls: 'r-c-adcost' },
    { icon: '⭐', label: '리뷰', value: fmt(r.review_count) + '건', cls: 'r-c-review' },
    { icon: '📞', label: '스마트콜', value: fmt(r.smart_calls) + '회', cls: 'r-c-call' },
  ]

  return (
    <div className="r-preview">
      {/* Section 1: Dashboard */}
      <div className="r-section">
        <div className="r-section-header">
          <h3>📊 성과 대시보드</h3>
          <span className="r-period">{fmtDate(r.period_start)} ~ {fmtDate(r.period_end)} ({r.period_type === 'weekly' ? '주간' : '월간'})</span>
        </div>
        <div className="r-dashboard-grid">
          {dashboard.map((c, i) => (
            <div key={i} className={`r-metric-card ${c.cls}`}>
              <span className="r-metric-icon">{c.icon}</span>
              <span className="r-metric-label">{c.label}</span>
              <span className="r-metric-value">{c.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Section 2: Summary points */}
      <EditableSection title="📝 성과 포인트 요약" value={r.summary_points}
        onSave={v => onUpdate({ summary_points: v })} />

      {/* Section 3: Channel analysis */}
      <div className="r-section">
        <h3>📊 채널별 성과 분석</h3>

        <h4 className="r-subtitle">네이버 검색광고</h4>
        {r.naver_campaigns_data?.length > 0 ? (
          <table className="r-table">
            <thead>
              <tr><th>캠페인</th><th>노출수</th><th>클릭수</th><th>광고비</th><th>CTR</th><th>CPC</th></tr>
            </thead>
            <tbody>
              {r.naver_campaigns_data.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td>{fmt(c.impCnt)}</td>
                  <td>{fmt(c.clkCnt)}</td>
                  <td>{fmt(c.salesAmt)}원</td>
                  <td>{c.ctr}%</td>
                  <td>{fmt(c.cpc)}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="r-empty">네이버 광고 데이터가 없습니다.</p>}

        <h4 className="r-subtitle" style={{ marginTop: 20 }}>메타 광고</h4>
        {r.meta_campaigns_data?.length > 0 ? (
          <table className="r-table">
            <thead>
              <tr><th>캠페인</th><th>노출수</th><th>클릭수</th><th>광고비</th><th>CTR</th><th>CPC</th></tr>
            </thead>
            <tbody>
              {r.meta_campaigns_data.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td>{fmt(c.impressions)}</td>
                  <td>{fmt(c.clicks)}</td>
                  <td>{fmt(c.markupCost)}원</td>
                  <td>{c.ctr}%</td>
                  <td>{fmt(c.cpc)}원</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="r-empty">메타 광고 데이터가 없습니다.</p>}

        <EditableSection title="" value={r.channel_analysis}
          onSave={v => onUpdate({ channel_analysis: v })} inline />
      </div>

      {/* Section 4: CAC */}
      <div className="r-section">
        <h3>🎯 CAC 분석</h3>
        <table className="r-table">
          <thead>
            <tr><th>총 광고비</th><th>방문객</th><th>CAC</th><th>ROAS</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>{fmt(r.total_ad_cost)}원</td>
              <td>{fmt(r.visitors)}팀</td>
              <td>{fmt(r.cac)}원</td>
              <td>{Number(r.roas || 0).toFixed(0)}%</td>
            </tr>
          </tbody>
        </table>
        <EditableSection title="" value={r.cac_analysis}
          onSave={v => onUpdate({ cac_analysis: v })} inline />
      </div>

      {/* Section 5: Keyword ranks */}
      <div className="r-section">
        <h3>🔑 키워드 순위 및 노출 현황</h3>
        <KeywordGroup label="🟢 상위 노출 (1~5위)" cls="r-kw-top" items={r.keyword_top} />
        <KeywordGroup label="🟡 상승 구간 (6~10위)" cls="r-kw-rising" items={r.keyword_rising} />
        <KeywordGroup label="🔴 개선 필요 (11위+)" cls="r-kw-improve" items={r.keyword_improve} />
      </div>

      {/* Section 6: Action plan */}
      <div className="r-section">
        <h3>📋 분석 요약 및 액션 플랜</h3>
        <div className="r-action-cols">
          <ActionList title="✅ 유지·강화" items={r.action_plan_keep || []}
            onSave={items => onUpdate({ action_plan_keep: items })} />
          <ActionList title="🚀 신규 시도" items={r.action_plan_try || []}
            onSave={items => onUpdate({ action_plan_try: items })} />
        </div>
      </div>

      {/* Section 7: Sales images */}
      {r.sales_images?.length > 0 && (
        <div className="r-section">
          <h3>📸 플레이스 통계 이미지</h3>
          <div className="r-images-grid">
            {r.sales_images.map((img, i) => (
              <img key={i} src={img.url} alt={img.original_name}
                className="r-img-thumb"
                onClick={() => setImgIdx(i)} />
            ))}
          </div>
          {imgIdx !== null && (
            <div className="r-img-modal" onClick={() => setImgIdx(null)}>
              <img src={r.sales_images[imgIdx].url} alt="" onClick={e => e.stopPropagation()} />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="r-actions">
        <button onClick={onExport} className="btn btn-primary">노션 내보내기</button>
        <button className="btn" disabled>저장됨</button>
      </div>
    </div>
  )
}

function EditableSection({ title, value, onSave, inline }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value || '')
  useEffect(() => { setText(value || '') }, [value])

  const save = () => {
    onSave(text)
    setEditing(false)
  }

  if (inline) {
    return (
      <div className="r-analysis-inline">
        {editing ? (
          <>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={3} />
            <div><button onClick={save} className="btn btn-sm btn-primary">저장</button></div>
          </>
        ) : (
          <p onClick={() => setEditing(true)} className="r-analysis-text">{value || '(분석 텍스트 없음)'}</p>
        )}
      </div>
    )
  }

  return (
    <div className="r-section">
      <h3>{title}</h3>
      {editing ? (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
            className="r-textarea" />
          <div className="r-edit-actions">
            <button onClick={() => { setText(value || ''); setEditing(false) }} className="btn btn-sm">취소</button>
            <button onClick={save} className="btn btn-sm btn-primary">저장</button>
          </div>
        </>
      ) : (
        <div onClick={() => setEditing(true)} className="r-analysis-text">
          {value ? value.split('\n').map((line, i) => <p key={i}>• {line}</p>) : <p>(분석 텍스트 없음)</p>}
        </div>
      )}
    </div>
  )
}

function KeywordGroup({ label, cls, items }) {
  if (!items?.length) return (
    <div className={`r-kw-group ${cls}`}>
      <span className="r-kw-label">{label}</span>
      <span className="r-kw-empty">해당 키워드 없음</span>
    </div>
  )
  return (
    <div className={`r-kw-group ${cls}`}>
      <span className="r-kw-label">{label}</span>
      <div className="r-kw-items">
        {items.map((kw, i) => (
          <span key={i} className="r-kw-chip">
            {kw.keyword}({kw.rank ? `${kw.rank}위` : '미노출'}{kw.volume ? `, 월${fmt(kw.volume)}` : ''})
          </span>
        ))}
      </div>
    </div>
  )
}

function ActionList({ title, items, onSave }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(items.join('\n'))
  useEffect(() => { setText(items.join('\n')) }, [items])

  const save = () => {
    const list = text.split('\n').map(s => s.trim()).filter(Boolean)
    onSave(list)
    setEditing(false)
  }

  return (
    <div className="r-action-col">
      <h4>{title}</h4>
      {editing ? (
        <>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={5}
            placeholder="한 줄에 하나씩 입력" />
          <div className="r-edit-actions">
            <button onClick={() => { setText(items.join('\n')); setEditing(false) }} className="btn btn-sm">취소</button>
            <button onClick={save} className="btn btn-sm btn-primary">저장</button>
          </div>
        </>
      ) : (
        <ul onClick={() => setEditing(true)} className="r-action-list">
          {items.length ? items.map((it, i) => <li key={i}>{it}</li>) : <li className="r-action-empty">항목 없음</li>}
        </ul>
      )}
    </div>
  )
}
