import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import './Sales.css'

const TREND_TABS = [
  { key: 'revenue', label: '매출' },
  { key: 'visitors', label: '방문객' },
  { key: 'conversion_rate', label: '전환율' },
]

function defaultPeriod() {
  const today = new Date()
  const day = today.getDay() // 0=Sun
  const monday = new Date(today)
  monday.setDate(today.getDate() - ((day + 6) % 7))
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return {
    start: monday.toISOString().split('T')[0],
    end: sunday.toISOString().split('T')[0]
  }
}

function fmt(n) { return Number(n || 0).toLocaleString() }
function fmtDate(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return `${parseInt(m)}.${parseInt(d)}`
}

export default function Sales() {
  const { token } = useAuth()
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [records, setRecords] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [trendTab, setTrendTab] = useState('revenue')
  const [galleryRecord, setGalleryRecord] = useState(null)
  const [galleryImages, setGalleryImages] = useState([])
  const [galleryIndex, setGalleryIndex] = useState(0)

  const headers = { Authorization: `Bearer ${token}` }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }

  const { start: defStart, end: defEnd } = defaultPeriod()
  const initialForm = {
    periodStart: defStart, periodEnd: defEnd, periodType: 'weekly',
    revenue: '', visitors: '', placeViews: '',
    smartCalls: '', reviewCount: '', memo: '',
    useMarkup: true
  }
  const [form, setForm] = useState(initialForm)
  const [pendingImages, setPendingImages] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/clients', { headers })
      .then(r => r.json()).then(setClients).catch(console.error)
  }, [])

  useEffect(() => {
    if (!selectedClientId) { setRecords([]); return }
    fetchRecords()
  }, [selectedClientId])

  const fetchRecords = async () => {
    const res = await fetch(`/api/sales/${selectedClientId}`, { headers })
    if (res.ok) {
      const data = await res.json()
      setRecords(data.records || [])
    }
  }

  const resetForm = () => {
    setForm(initialForm)
    setPendingImages([])
    setEditingId(null)
    setError('')
  }

  const startEdit = (r) => {
    setEditingId(r.id)
    setForm({
      periodStart: r.period_start,
      periodEnd: r.period_end,
      periodType: r.period_type,
      revenue: r.revenue,
      visitors: r.visitors,
      placeViews: r.place_views,
      smartCalls: r.smart_calls,
      reviewCount: r.review_count,
      memo: r.memo || '',
      useMarkup: r.use_markup == null ? true : !!r.use_markup
    })
    setPendingImages([])
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const saveRecord = async () => {
    if (!selectedClientId) return setError('광고주를 선택해주세요')
    if (!form.periodStart || !form.periodEnd) return setError('기간을 입력해주세요')

    setSaving(true)
    setError('')
    try {
      const url = editingId
        ? `/api/sales/${selectedClientId}/${editingId}`
        : `/api/sales/${selectedClientId}`
      const method = editingId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method, headers: jsonHeaders,
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      const recordId = data.record.id

      // Upload pending images
      for (const file of pendingImages) {
        const fd = new FormData()
        fd.append('image', file)
        await fetch(`/api/sales/${selectedClientId}/${recordId}/images`, {
          method: 'POST', headers, body: fd
        })
      }

      await fetchRecords()
      resetForm()
      setShowForm(false)
    } catch (err) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  const deleteRecord = async (id) => {
    if (!confirm('이 데이터를 삭제하시겠습니까?')) return
    await fetch(`/api/sales/${selectedClientId}/${id}`, { method: 'DELETE', headers })
    fetchRecords()
  }

  const refreshAdCost = async (id) => {
    const res = await fetch(`/api/sales/${selectedClientId}/${id}/refresh-adcost`, {
      method: 'POST', headers
    })
    if (res.ok) fetchRecords()
  }

  const toggleMarkup = async (record) => {
    const newUseMarkup = !record.use_markup
    await fetch(`/api/sales/${selectedClientId}/${record.id}`, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ useMarkup: newUseMarkup })
    })
    fetchRecords()
  }

  const openGallery = async (record) => {
    const res = await fetch(`/api/sales/${selectedClientId}/${record.id}`, { headers })
    if (!res.ok) return
    const data = await res.json()
    setGalleryRecord(record)
    setGalleryImages(data.images || [])
    setGalleryIndex(0)
  }

  const deleteImage = async (imgId) => {
    if (!galleryRecord) return
    await fetch(`/api/sales/${selectedClientId}/${galleryRecord.id}/images/${imgId}`, {
      method: 'DELETE', headers
    })
    setGalleryImages(prev => prev.filter(i => i.id !== imgId))
    if (galleryIndex >= galleryImages.length - 1) setGalleryIndex(Math.max(0, galleryIndex - 1))
    fetchRecords()
  }

  const handleFiles = (e) => {
    const files = Array.from(e.target.files || [])
    const remaining = 5 - pendingImages.length
    setPendingImages(prev => [...prev, ...files.slice(0, remaining)])
    e.target.value = ''
  }

  const removePending = (idx) => {
    setPendingImages(prev => prev.filter((_, i) => i !== idx))
  }

  // Live preview
  const previewUnitPrice = form.visitors > 0
    ? Math.round((form.revenue || 0) / form.visitors)
    : 0
  const previewConvRate = form.placeViews > 0
    ? ((form.visitors || 0) / form.placeViews) * 100
    : 0

  // Trend (last 8)
  const trend = [...records].slice(0, 8).reverse()

  return (
    <div className="page sales-page">
      <h2>매출 데이터</h2>

      <div className="s-controls">
        <div className="form-group">
          <label>광고주</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
            <option value="">-- 선택 --</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        </div>
        {selectedClientId && (
          <button onClick={() => { resetForm(); setShowForm(!showForm) }} className="btn btn-primary"
            style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
            {showForm ? '폼 닫기' : '+ 새 데이터 입력'}
          </button>
        )}
      </div>

      {showForm && selectedClientId && (
        <div className="s-form-card">
          <h3>{editingId ? '매출 데이터 수정' : '매출 데이터 입력'}</h3>
          {error && <div className="form-error">{error}</div>}

          <div className="s-form-row">
            <div className="form-group">
              <label>시작일</label>
              <input type="date" value={form.periodStart}
                onChange={e => setForm({ ...form, periodStart: e.target.value })} />
            </div>
            <div className="form-group">
              <label>종료일</label>
              <input type="date" value={form.periodEnd}
                onChange={e => setForm({ ...form, periodEnd: e.target.value })} />
            </div>
            <div className="form-group">
              <label>유형</label>
              <select value={form.periodType}
                onChange={e => setForm({ ...form, periodType: e.target.value })}>
                <option value="weekly">주차별</option>
                <option value="monthly">월별</option>
              </select>
            </div>
          </div>

          <div className="s-form-grid">
            <NumInput label="매출 (원)" value={form.revenue}
              onChange={v => setForm({ ...form, revenue: v })} />
            <NumInput label="방문객 수 (팀)" value={form.visitors}
              onChange={v => setForm({ ...form, visitors: v })} />
            <NumInput label="플레이스 유입 (회)" value={form.placeViews}
              onChange={v => setForm({ ...form, placeViews: v })} />
            <NumInput label="스마트콜 통화 (회)" value={form.smartCalls}
              onChange={v => setForm({ ...form, smartCalls: v })} />
            <NumInput label="리뷰 등록 (건)" value={form.reviewCount}
              onChange={v => setForm({ ...form, reviewCount: v })} />
          </div>

          <div className="form-group">
            <label>메모</label>
            <input value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })}
              placeholder="예: 첫 주차 보고서" />
          </div>

          <div className="s-preview">
            객단가: <strong>{fmt(previewUnitPrice)}원</strong>
            <span> | </span>
            전환율: <strong>{previewConvRate.toFixed(2)}%</strong>
            <span className="s-preview-hint">광고비 / CAC / ROAS는 저장 시 자동 계산됩니다</span>
          </div>

          <div className="s-markup-toggle-row">
            <span className="s-markup-label">메타 광고비:</span>
            <div className={`s-toggle ${form.useMarkup ? 'active' : ''}`}
              onClick={() => setForm({ ...form, useMarkup: !form.useMarkup })}>
              <span className="s-toggle-text">{form.useMarkup ? '마크업 적용' : '실비용'}</span>
            </div>
          </div>

          {!editingId && (
            <div className="s-image-upload">
              <label>이미지 업로드 (플레이스 통계 캡처 등, 최대 5장)</label>
              <input type="file" accept="image/*" multiple onChange={handleFiles}
                disabled={pendingImages.length >= 5} />
              <div className="s-pending-list">
                {pendingImages.map((f, i) => (
                  <span key={i} className="s-pending-item">
                    {f.name}
                    <button type="button" onClick={() => removePending(i)} className="s-pending-remove">×</button>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="s-form-actions">
            <button onClick={() => { resetForm(); setShowForm(false) }} className="btn">취소</button>
            <button onClick={saveRecord} className="btn btn-primary" disabled={saving}>
              {saving ? '저장 중...' : editingId ? '수정' : '저장'}
            </button>
          </div>
        </div>
      )}

      {/* Records list */}
      {records.length > 0 && (
        <div className="s-records">
          {records.map(r => <RecordCard key={r.id} r={r}
            onEdit={() => startEdit(r)}
            onDelete={() => deleteRecord(r.id)}
            onRefresh={() => refreshAdCost(r.id)}
            onGallery={() => openGallery(r)}
            onToggleMarkup={() => toggleMarkup(r)} />)}
        </div>
      )}

      {/* Trend Chart */}
      {trend.length > 1 && (
        <div className="s-trend">
          <div className="s-trend-header">
            <h3>주차별 트렌드 (최근 {trend.length}건)</h3>
            <div className="s-trend-tabs">
              {TREND_TABS.map(t => (
                <button key={t.key} className={`s-tab ${trendTab === t.key ? 'active' : ''}`}
                  onClick={() => setTrendTab(t.key)}>{t.label}</button>
              ))}
            </div>
          </div>
          <TrendChart data={trend} field={trendTab} />
        </div>
      )}

      {!selectedClientId && (
        <div className="placeholder">광고주를 선택해주세요.</div>
      )}

      {selectedClientId && records.length === 0 && !showForm && (
        <div className="placeholder">아직 입력된 매출 데이터가 없습니다. "새 데이터 입력" 버튼을 눌러주세요.</div>
      )}

      {/* Gallery modal */}
      {galleryRecord && (
        <ImageGallery
          record={galleryRecord}
          images={galleryImages}
          index={galleryIndex}
          setIndex={setGalleryIndex}
          onClose={() => setGalleryRecord(null)}
          onDelete={deleteImage}
        />
      )}
    </div>
  )
}

function NumInput({ label, value, onChange }) {
  return (
    <div className="form-group">
      <label>{label}</label>
      <input type="number" value={value}
        onChange={e => onChange(e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
        placeholder="0" />
    </div>
  )
}

function RecordCard({ r, onEdit, onDelete, onRefresh, onGallery, onToggleMarkup }) {
  const useMarkup = r.use_markup == null ? 1 : r.use_markup
  const metaCostShown = useMarkup ? (r.meta_ad_cost_markup || 0) : (r.meta_ad_cost_actual || 0)
  const cards = [
    { icon: '💰', label: '매출', value: fmt(r.revenue) + '원', cls: 's-c-revenue' },
    { icon: '👥', label: '방문객', value: fmt(r.visitors) + '팀', cls: 's-c-visitors' },
    { icon: '📊', label: '객단가', value: fmt(r.unit_price) + '원', cls: 's-c-unit' },
    { icon: '🔍', label: '플레이스 유입', value: fmt(r.place_views) + '회', cls: 's-c-views' },
    { icon: '📈', label: '전환율', value: (r.conversion_rate || 0).toFixed(2) + '%', cls: 's-c-conv' },
    { icon: '📞', label: '스마트콜', value: fmt(r.smart_calls) + '회', cls: 's-c-call' },
    { icon: '⭐', label: '리뷰', value: fmt(r.review_count) + '건', cls: 's-c-review' },
    { icon: '💳', label: '광고비', value: fmt(r.total_ad_cost) + '원', cls: 's-c-adcost' },
    { icon: '🎯', label: 'CAC', value: fmt(r.cac) + '원', cls: 's-c-cac' },
    { icon: '🚀', label: 'ROAS', value: (r.roas || 0).toFixed(0) + '%', cls: 's-c-roas' },
  ]

  return (
    <div className="s-record-card">
      <div className="s-record-header">
        <div className="s-record-period">
          📅 {fmtDate(r.period_start)} ~ {fmtDate(r.period_end)}
          <span className="s-record-type">({r.period_type === 'weekly' ? '주차별' : '월별'})</span>
        </div>
        <div className="s-record-actions">
          <div className={`s-toggle s-toggle-sm ${useMarkup ? 'active' : ''}`}
            onClick={onToggleMarkup} title="메타 광고비 마크업/실비용 전환">
            <span className="s-toggle-text">{useMarkup ? '마크업' : '실비용'}</span>
          </div>
          <button onClick={onRefresh} className="btn btn-sm">광고비 새로고침</button>
          <button onClick={onEdit} className="btn btn-sm">수정</button>
          <button onClick={onDelete} className="btn btn-sm btn-danger">삭제</button>
        </div>
      </div>

      <div className="s-metric-grid">
        {cards.map((c, i) => (
          <div key={i} className={`s-metric-card ${c.cls}`}>
            <span className="s-metric-icon">{c.icon}</span>
            <span className="s-metric-label">{c.label}</span>
            <span className="s-metric-value">{c.value}</span>
          </div>
        ))}
      </div>

      <div className="s-record-footer">
        <span className="s-adcost-detail">
          광고비: 네이버 {fmt(r.naver_ad_cost)}원 + 메타 {fmt(metaCostShown)}원
          <span className="s-adcost-mode">({useMarkup ? '마크업' : '실비용'})</span>
        </span>
        {r.image_count > 0 && (
          <button onClick={onGallery} className="btn btn-sm">
            이미지 {r.image_count}장 보기
          </button>
        )}
        {r.memo && <span className="s-memo">📝 {r.memo}</span>}
      </div>
    </div>
  )
}

function TrendChart({ data, field }) {
  const max = Math.max(...data.map(d => d[field] || 0), 1)
  const formatter = field === 'conversion_rate'
    ? (v) => (v || 0).toFixed(2) + '%'
    : (v) => fmt(v)

  return (
    <div className="s-chart">
      {data.map((d, i) => {
        const val = d[field] || 0
        const heightPct = (val / max) * 100
        const prev = i > 0 ? data[i - 1][field] || 0 : null
        const diff = prev != null && prev > 0 ? ((val - prev) / prev) * 100 : null
        return (
          <div key={d.id} className="s-chart-col">
            <div className="s-chart-value">{formatter(val)}</div>
            {diff != null && (
              <div className={`s-chart-diff ${diff > 0 ? 'up' : diff < 0 ? 'down' : ''}`}>
                {diff > 0 ? '▲' : diff < 0 ? '▼' : '-'}{Math.abs(diff).toFixed(0)}%
              </div>
            )}
            <div className="s-chart-bar-wrap">
              <div className="s-chart-bar" style={{ height: heightPct + '%' }} />
            </div>
            <div className="s-chart-label">{fmtDate(d.period_start)}</div>
          </div>
        )
      })}
    </div>
  )
}

function ImageGallery({ record, images, index, setIndex, onClose, onDelete }) {
  const [loadError, setLoadError] = useState(false)
  useEffect(() => { setLoadError(false) }, [index])

  if (!images.length) {
    return (
      <div className="s-modal-overlay" onClick={onClose}>
        <div className="s-modal" onClick={e => e.stopPropagation()}>
          <div className="s-modal-header">
            <h3>이미지 ({fmtDate(record.period_start)} ~ {fmtDate(record.period_end)})</h3>
            <button onClick={onClose} className="s-modal-close">×</button>
          </div>
          <div className="s-modal-body"><p>이미지가 없습니다.</p></div>
        </div>
      </div>
    )
  }
  const img = images[index]
  const url = `/uploads/sales/${record.client_id}/${record.id}/${encodeURIComponent(img.filename)}`

  return (
    <div className="s-modal-overlay" onClick={onClose}>
      <div className="s-modal s-modal-gallery" onClick={e => e.stopPropagation()}>
        <div className="s-modal-header">
          <h3>{img.original_name} ({index + 1}/{images.length})</h3>
          <div className="s-modal-header-actions">
            <button onClick={() => onDelete(img.id)} className="btn btn-sm btn-danger">삭제</button>
            <button onClick={onClose} className="s-modal-close">×</button>
          </div>
        </div>
        <div className="s-modal-body s-gallery-body">
          <button className="s-gallery-nav" onClick={() => setIndex(Math.max(0, index - 1))}
            disabled={index === 0}>‹</button>
          {loadError ? (
            <div className="s-gallery-error">
              <p>이미지를 불러올 수 없습니다.</p>
              <p className="s-gallery-error-path">{url}</p>
            </div>
          ) : (
            <img src={url} alt={img.original_name} className="s-gallery-image"
              onError={() => setLoadError(true)} />
          )}
          <button className="s-gallery-nav" onClick={() => setIndex(Math.min(images.length - 1, index + 1))}
            disabled={index >= images.length - 1}>›</button>
        </div>
      </div>
    </div>
  )
}
