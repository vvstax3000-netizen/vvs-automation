import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import RankHistory from './RankHistory'

export default function KeywordManager({ clientId }) {
  const { token } = useAuth()
  const [client, setClient] = useState(null)
  const [keywords, setKeywords] = useState([])
  const [newKeyword, setNewKeyword] = useState('')
  const [sortBy, setSortBy] = useState('default')
  const [refreshing, setRefreshing] = useState(false)
  const [historyKeyword, setHistoryKeyword] = useState(null)
  const [editingMemo, setEditingMemo] = useState(null)
  const [placeName, setPlaceName] = useState('')
  const [slug, setSlug] = useState('')
  const [saving, setSaving] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }

  useEffect(() => {
    fetchClient()
    fetchKeywords()
  }, [clientId])

  const fetchClient = async () => {
    const res = await fetch(`/api/clients/${clientId}`, { headers })
    if (res.ok) {
      const data = await res.json()
      setClient(data)
      setPlaceName(data.place_name || '')
      setSlug(data.slug || '')
    }
  }

  const fetchKeywords = async () => {
    const res = await fetch(`/api/rank-tracker/${clientId}/keywords`, { headers })
    if (res.ok) setKeywords(await res.json())
  }

  const addKeywords = async () => {
    if (!newKeyword.trim()) return
    const kws = newKeyword.split(',').map(k => k.trim()).filter(Boolean)
    const res = await fetch(`/api/rank-tracker/${clientId}/keywords`, {
      method: 'POST', headers: jsonHeaders,
      body: JSON.stringify({ keywords: kws })
    })
    if (res.ok) {
      setNewKeyword('')
      fetchKeywords()
    }
  }

  const deleteKeyword = async (id) => {
    if (!confirm('키워드를 삭제하시겠습니까?')) return
    await fetch(`/api/rank-tracker/keywords/${id}`, { method: 'DELETE', headers })
    fetchKeywords()
  }

  const saveMemo = async (id, memo) => {
    await fetch(`/api/rank-tracker/keywords/${id}/memo`, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ memo })
    })
    setEditingMemo(null)
    fetchKeywords()
  }

  const refreshRanks = async () => {
    if (!placeName) return alert('플레이스명을 먼저 설정해주세요')
    setRefreshing(true)
    try {
      const res = await fetch(`/api/rank-tracker/${clientId}/refresh`, {
        method: 'POST', headers
      })
      const data = await res.json()
      if (res.ok) fetchKeywords()
      else alert(data.error || '업데이트 실패')
    } finally {
      setRefreshing(false)
    }
  }

  const fetchSearchVolume = async () => {
    try {
      const res = await fetch(`/api/rank-tracker/${clientId}/search-volume`, {
        method: 'POST', headers
      })
      const data = await res.json()
      if (res.ok) fetchKeywords()
      else alert(data.error || '검색량 조회 실패')
    } catch (err) {
      alert('검색량 조회 중 오류가 발생했습니다')
    }
  }

  const saveSettings = async () => {
    if (!client) return
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}`, {
        method: 'PUT', headers: jsonHeaders,
        body: JSON.stringify({ ...client, place_name: placeName, slug })
      })
      if (res.ok) fetchClient()
      else {
        const data = await res.json()
        alert(data.error || '저장 실패')
      }
    } finally {
      setSaving(false)
    }
  }

  const sorted = sortKeywords(keywords, sortBy)

  return (
    <div className="keyword-manager">
      {/* Settings */}
      <div className="settings-section">
        <h3>순위 추적 설정</h3>
        <div className="settings-row">
          <div className="form-group">
            <label>네이버 플레이스명 (검색 결과에 표시되는 정확한 업체명)</label>
            <input value={placeName} onChange={e => setPlaceName(e.target.value)}
              placeholder="예: 돈치킨 부평점" />
          </div>
          <div className="form-group">
            <label>공유 슬러그 (공유 URL에 사용)</label>
            <input value={slug} onChange={e => setSlug(e.target.value)}
              placeholder="예: donchicken" />
          </div>
          <button onClick={saveSettings} className="btn btn-primary" disabled={saving}>
            {saving ? '저장 중...' : '설정 저장'}
          </button>
        </div>
        {slug && (
          <p className="share-link">
            공유 링크: <a href={`/rank/${slug}`} target="_blank" rel="noreferrer">
              {window.location.origin}/rank/{slug}
            </a>
          </p>
        )}
      </div>

      {/* Add keywords */}
      <div className="add-keyword-section">
        <input
          value={newKeyword}
          onChange={e => setNewKeyword(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addKeywords()}
          placeholder="키워드 입력 (쉼표로 구분하여 여러 개 등록 가능)"
        />
        <button onClick={addKeywords} className="btn btn-primary">키워드 추가</button>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <span className="keyword-count">{keywords.length}개 키워드</span>
        <div className="toolbar-actions">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="default">기본 순서</option>
            <option value="unexposed">미노출 먼저</option>
            <option value="rank-asc">순위 오름차순</option>
            <option value="rank-desc">순위 내림차순</option>
            <option value="name">키워드명 순</option>
          </select>
          <button onClick={fetchSearchVolume} className="btn">검색량 조회</button>
          <button onClick={refreshRanks} className="btn btn-primary" disabled={refreshing}>
            {refreshing ? '크롤링 중...' : '즉시 최신화'}
          </button>
        </div>
      </div>

      {/* Warning */}
      {!placeName && (
        <div className="warning-box">
          순위를 확인하려면 먼저 "네이버 플레이스명"을 설정해주세요.
        </div>
      )}

      {/* Table */}
      {sorted.length === 0 ? (
        <p className="empty-state">등록된 키워드가 없습니다.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>키워드</th>
              <th>검색량</th>
              <th>현재 순위</th>
              <th>메모</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((kw, idx) => (
              <tr key={kw.id}>
                <td>{idx + 1}</td>
                <td>
                  <a href={`https://search.naver.com/search.naver?query=${encodeURIComponent(kw.keyword)}`}
                    target="_blank" rel="noreferrer" className="keyword-link">
                    {kw.keyword}
                  </a>
                </td>
                <td>{kw.search_volume || '-'}</td>
                <td>
                  {kw.latest_date ? (
                    kw.latest_rank ? (
                      <span className={`rank-badge ${getRankClass(kw.latest_rank)}`}>
                        {kw.latest_rank}위
                      </span>
                    ) : (
                      <span className="rank-badge rank-none">미노출</span>
                    )
                  ) : '-'}
                </td>
                <td className="memo-cell">
                  {editingMemo?.id === kw.id ? (
                    <div className="memo-edit">
                      <input
                        value={editingMemo.text}
                        onChange={e => setEditingMemo({ ...editingMemo, text: e.target.value })}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveMemo(kw.id, editingMemo.text)
                          if (e.key === 'Escape') setEditingMemo(null)
                        }}
                        autoFocus
                      />
                      <button onClick={() => saveMemo(kw.id, editingMemo.text)} className="btn btn-sm">저장</button>
                    </div>
                  ) : (
                    <div className="memo-display"
                      onClick={() => setEditingMemo({ id: kw.id, text: kw.memo || '' })}>
                      {kw.memo || <span className="text-muted">메모 추가</span>}
                    </div>
                  )}
                </td>
                <td className="actions">
                  <button onClick={() => setHistoryKeyword(kw)} className="btn btn-sm">일별 순위</button>
                  <button onClick={() => deleteKeyword(kw.id)} className="btn btn-sm btn-danger">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {keywords.length > 0 && keywords[0]?.latest_date && (
        <p className="update-info">마지막 업데이트: {keywords[0].latest_date}</p>
      )}

      {historyKeyword && (
        <RankHistory
          keywordId={historyKeyword.id}
          keyword={historyKeyword.keyword}
          token={token}
          onClose={() => setHistoryKeyword(null)}
        />
      )}
    </div>
  )
}

function sortKeywords(keywords, sortBy) {
  const sorted = [...keywords]
  switch (sortBy) {
    case 'rank-asc':
      return sorted.sort((a, b) => {
        if (!a.latest_rank && !b.latest_rank) return 0
        if (!a.latest_rank) return 1
        if (!b.latest_rank) return -1
        return a.latest_rank - b.latest_rank
      })
    case 'rank-desc':
      return sorted.sort((a, b) => {
        if (!a.latest_rank && !b.latest_rank) return 0
        if (!a.latest_rank) return 1
        if (!b.latest_rank) return -1
        return b.latest_rank - a.latest_rank
      })
    case 'unexposed':
      return sorted.sort((a, b) => {
        if (!a.latest_rank && b.latest_rank) return -1
        if (a.latest_rank && !b.latest_rank) return 1
        return 0
      })
    case 'name':
      return sorted.sort((a, b) => a.keyword.localeCompare(b.keyword, 'ko'))
    default:
      return sorted
  }
}

function getRankClass(rank) {
  if (rank <= 3) return 'rank-top'
  if (rank <= 10) return 'rank-high'
  if (rank <= 50) return 'rank-mid'
  return 'rank-low'
}
