import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import RankHistory from '../rank-tracker/RankHistory'
import '../rank-tracker/RankTracker.css'
import './RankView.css'

export default function RankView() {
  const { clientSlug } = useParams()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortBy, setSortBy] = useState('default')
  const [historyKeyword, setHistoryKeyword] = useState(null)

  useEffect(() => {
    fetch(`/api/public/rank/${clientSlug}`)
      .then(res => {
        if (!res.ok) throw new Error('페이지를 찾을 수 없습니다')
        return res.json()
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [clientSlug])

  if (loading) return <div className="public-page"><p>로딩 중...</p></div>
  if (error) return <div className="public-page"><h2>오류</h2><p>{error}</p></div>

  const sorted = sortKeywords(data.keywords, sortBy)

  return (
    <div className="public-page rank-public">
      <div className="rank-public-header">
        <h1>{data.client.company_name}</h1>
        <p>네이버 플레이스 순위 현황</p>
      </div>

      <div className="toolbar">
        <span className="keyword-count">{data.keywords.length}개 키워드</span>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="default">기본 순서</option>
          <option value="unexposed">미노출 먼저</option>
          <option value="rank-asc">순위 오름차순</option>
          <option value="rank-desc">순위 내림차순</option>
          <option value="name">키워드명 순</option>
        </select>
      </div>

      {sorted.length === 0 ? (
        <p className="empty-state">등록된 키워드가 없습니다.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>키워드</th>
              <th>현재 순위</th>
              <th>메모</th>
              <th></th>
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
                <td>
                  {kw.latest_date ? (
                    kw.latest_rank ? (
                      <span className="rank-with-change">
                        <span className={`rank-badge ${getRankClass(kw.latest_rank)}`}>{kw.latest_rank}위</span>
                        {kw.prev_rank && kw.latest_rank !== kw.prev_rank && (
                          kw.prev_rank > kw.latest_rank
                            ? <span className="rank-change rank-up">&#9650;{kw.prev_rank - kw.latest_rank}</span>
                            : <span className="rank-change rank-down">&#9660;{kw.latest_rank - kw.prev_rank}</span>
                        )}
                      </span>
                    ) : (
                      <span className="rank-badge rank-none">미노출</span>
                    )
                  ) : '-'}
                </td>
                <td className="text-muted" style={{ fontSize: '0.85rem' }}>{kw.memo || ''}</td>
                <td>
                  <button onClick={() => setHistoryKeyword(kw)} className="btn btn-sm">일별 순위</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {data.keywords.length > 0 && data.keywords[0]?.latest_date && (
        <p className="update-info">마지막 업데이트: {data.keywords[0].latest_date}</p>
      )}

      {historyKeyword && (
        <RankHistory
          keywordId={historyKeyword.id}
          keyword={historyKeyword.keyword}
          isPublic
          slug={clientSlug}
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
