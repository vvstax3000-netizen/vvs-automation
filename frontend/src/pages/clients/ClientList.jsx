import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import './Clients.css'

export default function ClientList() {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const { token } = useAuth()

  const fetchClients = async () => {
    try {
      const res = await fetch('/api/clients', {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (res.ok) {
        setClients(await res.json())
      }
    } catch (err) {
      console.error('Failed to fetch clients:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchClients() }, [])

  const handleDelete = async (id, name) => {
    if (!confirm(`"${name}" 광고주를 삭제하시겠습니까?`)) return
    try {
      await fetch(`/api/clients/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      fetchClients()
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  if (loading) return <div className="page"><p>로딩 중...</p></div>

  return (
    <div className="page">
      <div className="page-header">
        <h2>광고주 관리</h2>
        <Link to="/dashboard/clients/new" className="btn btn-primary">+ 광고주 등록</Link>
      </div>
      {clients.length === 0 ? (
        <p className="empty-state">등록된 광고주가 없습니다.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>업체명</th>
              <th>업종</th>
              <th>담당자</th>
              <th>연락처</th>
              <th>계약기간</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {clients.map(client => (
              <tr key={client.id}>
                <td>{client.company_name}</td>
                <td>{client.industry || '-'}</td>
                <td>{client.contact_person || '-'}</td>
                <td>{client.phone || '-'}</td>
                <td>
                  {client.contract_start && client.contract_end
                    ? `${client.contract_start} ~ ${client.contract_end}`
                    : '-'}
                </td>
                <td className="actions">
                  <Link to={`/dashboard/clients/${client.id}/edit`} className="btn btn-sm">수정</Link>
                  <button onClick={() => handleDelete(client.id, client.company_name)} className="btn btn-sm btn-danger">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
