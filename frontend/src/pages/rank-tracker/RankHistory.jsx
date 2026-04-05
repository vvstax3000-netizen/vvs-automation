import { useState, useEffect } from 'react'

export default function RankHistory({ keywordId, keyword, onClose, token, isPublic, slug }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const url = isPublic
      ? `/api/public/rank/${slug}/keywords/${keywordId}/history`
      : `/api/rank-tracker/keywords/${keywordId}/history`

    const headers = isPublic ? {} : { Authorization: `Bearer ${token}` }

    fetch(url, { headers })
      .then(res => res.json())
      .then(setRecords)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [keywordId])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>"{keyword}" 일별 순위</h3>
          <button onClick={onClose} className="modal-close">&times;</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <p>로딩 중...</p>
          ) : records.length === 0 ? (
            <p className="empty-state">기록이 없습니다.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>순위</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.recorded_date}>
                    <td>{r.recorded_date}</td>
                    <td>
                      {r.rank ? (
                        <span className={`rank-badge ${getRankClass(r.rank)}`}>{r.rank}위</span>
                      ) : (
                        <span className="rank-badge rank-none">미노출</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function getRankClass(rank) {
  if (rank <= 3) return 'rank-top'
  if (rank <= 10) return 'rank-high'
  if (rank <= 50) return 'rank-mid'
  return 'rank-low'
}
