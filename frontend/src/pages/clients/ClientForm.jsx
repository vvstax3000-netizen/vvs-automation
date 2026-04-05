import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import './Clients.css'

const initialForm = {
  company_name: '', industry: '', address: '',
  contact_person: '', phone: '',
  contract_start: '', contract_end: '',
  naver_api_license: '', naver_api_secret: '', naver_customer_id: '',
  meta_ad_account_id: '',
  place_name: '', slug: '',
}

export default function ClientForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const [form, setForm] = useState(initialForm)
  const [error, setError] = useState('')
  const { token } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isEdit) {
      fetch(`/api/clients/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(res => res.json())
        .then(data => {
          const updated = {}
          for (const key of Object.keys(initialForm)) {
            updated[key] = data[key] || ''
          }
          setForm(updated)
        })
        .catch(() => setError('데이터를 불러올 수 없습니다'))
    }
  }, [id])

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const res = await fetch(isEdit ? `/api/clients/${id}` : '/api/clients', {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(form)
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error)
      }
      navigate('/dashboard/clients')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <h2>{isEdit ? '광고주 수정' : '광고주 등록'}</h2>
      {error && <div className="form-error">{error}</div>}
      <form className="client-form" onSubmit={handleSubmit}>
        <fieldset>
          <legend>기본 정보</legend>
          <div className="form-row">
            <div className="form-group">
              <label>업체명 *</label>
              <input name="company_name" value={form.company_name} onChange={handleChange} required />
            </div>
            <div className="form-group">
              <label>업종</label>
              <input name="industry" value={form.industry} onChange={handleChange} />
            </div>
          </div>
          <div className="form-group">
            <label>주소</label>
            <input name="address" value={form.address} onChange={handleChange} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>담당자명</label>
              <input name="contact_person" value={form.contact_person} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>연락처</label>
              <input name="phone" value={form.phone} onChange={handleChange} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>계약 시작일</label>
              <input type="date" name="contract_start" value={form.contract_start} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>계약 종료일</label>
              <input type="date" name="contract_end" value={form.contract_end} onChange={handleChange} />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>플레이스 순위 추적</legend>
          <div className="form-row">
            <div className="form-group">
              <label>네이버 플레이스명 (검색 결과에 표시되는 정확한 업체명)</label>
              <input name="place_name" value={form.place_name} onChange={handleChange}
                placeholder="예: 돈치킨 부평점" />
            </div>
            <div className="form-group">
              <label>공유 슬러그 (순위 공유 URL에 사용)</label>
              <input name="slug" value={form.slug} onChange={handleChange}
                placeholder="예: donchicken" />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend>네이버 검색광고 API</legend>
          <div className="form-row">
            <div className="form-group">
              <label>API License</label>
              <input name="naver_api_license" value={form.naver_api_license} onChange={handleChange} />
            </div>
            <div className="form-group">
              <label>API Secret</label>
              <input name="naver_api_secret" value={form.naver_api_secret} onChange={handleChange} type="password" />
            </div>
          </div>
          <div className="form-group">
            <label>Customer ID</label>
            <input name="naver_customer_id" value={form.naver_customer_id} onChange={handleChange} />
          </div>
        </fieldset>

        <fieldset>
          <legend>메타 광고</legend>
          <div className="form-group">
            <label>메타 광고 계정 ID</label>
            <input name="meta_ad_account_id" value={form.meta_ad_account_id} onChange={handleChange} />
          </div>
        </fieldset>

        <div className="form-actions">
          <button type="button" className="btn" onClick={() => navigate('/dashboard/clients')}>취소</button>
          <button type="submit" className="btn btn-primary">{isEdit ? '수정' : '등록'}</button>
        </div>
      </form>
    </div>
  )
}
