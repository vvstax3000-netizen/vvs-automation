import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../context/AuthContext'
import './KeywordDiscovery.css'

const DEFAULT_LOCATIONS = ['부평', '청천동', '청천', '산곡역', '인천부평', '부평구']
const DEFAULT_MENUS = ['맛집', '밥집', '닭갈비', '철판닭갈비', '점심맛집', '회식']

export default function KeywordDiscovery() {
  const { token } = useAuth()
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const [client, setClient] = useState(null)

  const [locations, setLocations] = useState([])
  const [menus, setMenus] = useState([])
  const [brandKeywords, setBrandKeywords] = useState([])
  const [locInput, setLocInput] = useState('')
  const [menuInput, setMenuInput] = useState('')
  const [brandInput, setBrandInput] = useState('')

  const [generatedKeywords, setGeneratedKeywords] = useState([])
  const [rankResults, setRankResults] = useState([])
  const [progress, setProgress] = useState(null)
  const [running, setRunning] = useState(false)
  const [volumeLoading, setVolumeLoading] = useState(false)
  const [error, setError] = useState('')
  const [filterTop10, setFilterTop10] = useState(true)
  const [currentJobId, setCurrentJobId] = useState(null)
  const pollIntervalRef = useRef(null)

  const headers = { Authorization: `Bearer ${token}` }
  const jsonHeaders = { ...headers, 'Content-Type': 'application/json' }

  useEffect(() => {
    fetch('/api/clients', { headers })
      .then(r => r.json())
      .then(list => setClients(list.filter(c => c.place_name)))
      .catch(console.error)
    // Cleanup on unmount
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current)
    }
  }, [])

  useEffect(() => {
    if (!selectedClientId) { setClient(null); return }
    fetch(`/api/clients/${selectedClientId}`, { headers })
      .then(r => r.json()).then(setClient)
    fetch(`/api/keyword-discovery/${selectedClientId}/preset`, { headers })
      .then(r => r.json()).then(p => {
        setLocations(p.locations?.length ? p.locations : DEFAULT_LOCATIONS)
        setMenus(p.menus?.length ? p.menus : DEFAULT_MENUS)
        setBrandKeywords(p.brandKeywords || [])
      })
    fetch(`/api/keyword-discovery/${selectedClientId}/results`, { headers })
      .then(r => r.json()).then(setRankResults)
  }, [selectedClientId])

  const generateKeywords = async () => {
    if (!selectedClientId) return setError('광고주를 선택해주세요')
    setError('')
    try {
      const res = await fetch('/api/keyword-discovery/generate', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ clientId: selectedClientId, locations, menus, brandKeywords })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setGeneratedKeywords(data.keywords)
    } catch (err) { setError(err.message) }
  }

  const fetchSearchVolume = async (top10Keywords) => {
    setVolumeLoading(true)
    try {
      const res = await fetch('/api/keyword-discovery/search-volume', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({ clientId: selectedClientId, keywords: top10Keywords })
      })
      const data = await res.json()
      if (res.ok && data.results) {
        const volMap = {}
        for (const v of data.results) volMap[v.keyword] = v
        setRankResults(prev => prev.map(r => {
          const v = volMap[r.keyword]
          if (!v) return r
          return {
            ...r,
            monthly_pc_qc_cnt: v.monthlyPcQcCnt,
            monthly_mobile_qc_cnt: v.monthlyMobileQcCnt,
            total_search_volume: v.totalSearchVolume
          }
        }))
      }
    } finally { setVolumeLoading(false) }
  }

  const startRankCheck = async () => {
    if (!generatedKeywords.length) return setError('먼저 키워드를 생성해주세요')
    if (!client?.place_name) return setError('광고주의 플레이스명이 없습니다')

    setError('')
    setRunning(true)
    setRankResults([])
    setProgress({ current: 0, total: generatedKeywords.length })

    try {
      const res = await fetch('/api/keyword-discovery/start-check', {
        method: 'POST', headers: jsonHeaders,
        body: JSON.stringify({
          clientId: selectedClientId,
          placeName: client.place_name,
          keywords: generatedKeywords
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '작업 시작 실패')
      setCurrentJobId(data.jobId)

      let lastIndex = 0
      const poll = async () => {
        try {
          const statusRes = await fetch(
            `/api/keyword-discovery/check-status/${data.jobId}?lastIndex=${lastIndex}`,
            { headers }
          )
          const status = await statusRes.json()
          if (!statusRes.ok) throw new Error(status.error)

          setProgress({ current: status.progress.current, total: status.progress.total })

          if (status.newResults?.length > 0) {
            setRankResults(prev => [
              ...prev,
              ...status.newResults.map(r => ({
                keyword: r.keyword,
                rank: r.rank,
                monthly_pc_qc_cnt: 0,
                monthly_mobile_qc_cnt: 0,
                total_search_volume: 0
              }))
            ])
            lastIndex += status.newResults.length
          }

          if (status.status === 'done' || status.status === 'stopped' || status.status === 'error') {
            clearInterval(pollIntervalRef.current)
            pollIntervalRef.current = null
            setRunning(false)
            setCurrentJobId(null)

            if (status.status === 'error') setError(status.error || '조회 중 오류가 발생했습니다')

            // Auto-fetch search volume for top 10
            if (status.status === 'done') {
              const top10 = status.results.filter(r => r.rank && r.rank <= 10).map(r => r.keyword)
              if (top10.length) fetchSearchVolume(top10)
            }
          }
        } catch (err) {
          console.error('폴링 에러:', err)
        }
      }

      pollIntervalRef.current = setInterval(poll, 2000)
      poll() // immediate first call
    } catch (err) {
      setError(err.message)
      setRunning(false)
    }
  }

  const stopRankCheck = async () => {
    if (currentJobId) {
      try {
        await fetch(`/api/keyword-discovery/stop-check/${currentJobId}`, {
          method: 'POST', headers
        })
      } catch {}
    }
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
    setRunning(false)
    setCurrentJobId(null)
  }

  const downloadCsv = () => {
    const rows = [['키워드', '순위', 'PC 검색량', '모바일 검색량', '합계', '리워드 가능']]
    const data = filteredResults
    for (const r of data) {
      rows.push([
        r.keyword,
        r.rank || '미노출',
        r.monthly_pc_qc_cnt || 0,
        r.monthly_mobile_qc_cnt || 0,
        r.total_search_volume || 0,
        r.rank && r.rank <= 10 && r.total_search_volume > 0 ? 'O' : 'X'
      ])
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const bom = '﻿'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `keyword-discovery-${client?.company_name || 'export'}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredResults = filterTop10
    ? rankResults.filter(r => r.rank && r.rank <= 10)
    : rankResults
  const sorted = [...filteredResults].sort((a, b) =>
    (b.total_search_volume || 0) - (a.total_search_volume || 0) ||
    (a.rank || 999) - (b.rank || 999)
  )

  const rankClass = (rank) => {
    if (!rank) return 'k-rank-none'
    if (rank <= 10) return 'k-rank-top'
    if (rank <= 20) return 'k-rank-mid'
    return 'k-rank-low'
  }

  return (
    <div className="page k-page">
      <h2>키워드 발굴</h2>
      <p className="k-desc">지역 × 업종 조합으로 키워드를 대량 생성하여, 10위 이내 + 검색량 있는 리워드용 키워드를 찾아냅니다.</p>

      {error && <div className="form-error">{error}</div>}

      {/* Settings */}
      <div className="k-settings">
        <div className="form-group">
          <label>광고주</label>
          <select value={selectedClientId} onChange={e => setSelectedClientId(e.target.value)}>
            <option value="">-- 선택 --</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.company_name} ({c.place_name})</option>
            ))}
          </select>
        </div>

        <TagInput label="지역명" placeholder="예: 부평, 청천동"
          tags={locations} setTags={setLocations} input={locInput} setInput={setLocInput} />
        <TagInput label="업종/메뉴" placeholder="예: 맛집, 닭갈비"
          tags={menus} setTags={setMenus} input={menuInput} setInput={setMenuInput} />
        <TagInput label="브랜드 키워드 (직접 추가)" placeholder="예: 홍춘천, 부평홍춘천"
          tags={brandKeywords} setTags={setBrandKeywords} input={brandInput} setInput={setBrandInput} />

        <div className="k-actions">
          <button onClick={generateKeywords} className="btn" disabled={running}>키워드 생성</button>
          {generatedKeywords.length > 0 && (
            <span className="k-gen-count">총 {generatedKeywords.length}개 키워드 생성됨</span>
          )}
          <button onClick={startRankCheck} className="btn btn-primary"
            disabled={running || !generatedKeywords.length}>
            순위 조회 시작
          </button>
          {running && (
            <button onClick={stopRankCheck} className="btn btn-danger">중지</button>
          )}
        </div>
      </div>

      {/* Progress */}
      {progress && running && (
        <div className="k-progress-section">
          <div className="k-progress-text">{progress.current}/{progress.total} 조회 중...</div>
          <div className="k-progress-bar">
            <div className="k-progress-fill"
              style={{ width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}
      {volumeLoading && <p className="k-loading">검색량 조회 중...</p>}

      {/* Results */}
      {rankResults.length > 0 && (
        <>
          <div className="k-toolbar">
            <span className="k-result-count">
              결과 {sorted.length}개 {filterTop10 && `(전체 ${rankResults.length}개 중 10위 이내만)`}
            </span>
            <div className="k-toolbar-actions">
              <button onClick={() => setFilterTop10(!filterTop10)} className="btn btn-sm">
                {filterTop10 ? '전체 보기' : '10위 이내만 보기'}
              </button>
              <button onClick={downloadCsv} className="btn btn-sm" disabled={!sorted.length}>
                CSV 다운로드
              </button>
            </div>
          </div>

          <table className="data-table k-table">
            <thead>
              <tr>
                <th>#</th>
                <th>키워드</th>
                <th>순위</th>
                <th>PC 검색량</th>
                <th>모바일 검색량</th>
                <th>합계</th>
                <th>리워드</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const total = r.total_search_volume || 0
                const usable = r.rank && r.rank <= 10 && total > 0
                return (
                  <tr key={r.keyword}>
                    <td>{i + 1}</td>
                    <td>{r.keyword}</td>
                    <td>
                      <span className={`k-rank-badge ${rankClass(r.rank)}`}>
                        {r.rank ? `${r.rank}위` : '미노출'}
                      </span>
                    </td>
                    <td>{(r.monthly_pc_qc_cnt || 0).toLocaleString()}</td>
                    <td>{(r.monthly_mobile_qc_cnt || 0).toLocaleString()}</td>
                    <td><strong>{total.toLocaleString()}</strong></td>
                    <td>{usable ? '✅' : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {!selectedClientId && (
        <div className="placeholder">광고주를 선택하세요 (플레이스명이 설정된 광고주만 표시됩니다).</div>
      )}
    </div>
  )
}

function TagInput({ label, placeholder, tags, setTags, input, setInput }) {
  const add = () => {
    const v = input.trim()
    if (!v || tags.includes(v)) { setInput(''); return }
    setTags([...tags, v])
    setInput('')
  }
  const remove = (t) => setTags(tags.filter(x => x !== t))
  return (
    <div className="form-group">
      <label>{label}</label>
      <div className="k-tag-container">
        {tags.map(t => (
          <span key={t} className="k-tag">
            {t}
            <button type="button" onClick={() => remove(t)} className="k-tag-remove">×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add() }
            if (e.key === 'Backspace' && !input && tags.length) setTags(tags.slice(0, -1))
          }}
          onBlur={add}
          placeholder={placeholder}
          className="k-tag-input"
        />
      </div>
    </div>
  )
}
