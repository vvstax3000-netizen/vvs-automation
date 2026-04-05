import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import KeywordManager from './KeywordManager'
import './RankTracker.css'

export default function RankTracker() {
  const [clients, setClients] = useState([])
  const [selectedClientId, setSelectedClientId] = useState('')
  const { token } = useAuth()

  useEffect(() => {
    fetch('/api/clients', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => res.json())
      .then(setClients)
      .catch(console.error)
  }, [])

  return (
    <div className="page">
      <h2>네이버 플레이스 순위 추적</h2>

      <div className="client-selector">
        <label>광고주 선택</label>
        <select
          value={selectedClientId}
          onChange={e => setSelectedClientId(e.target.value)}
        >
          <option value="">-- 광고주를 선택하세요 --</option>
          {clients.map(c => (
            <option key={c.id} value={c.id}>{c.company_name}</option>
          ))}
        </select>
      </div>

      {selectedClientId ? (
        <KeywordManager clientId={selectedClientId} />
      ) : (
        <div className="placeholder">광고주를 선택하면 키워드 순위를 관리할 수 있습니다.</div>
      )}
    </div>
  )
}
