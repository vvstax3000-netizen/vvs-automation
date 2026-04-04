import { useParams } from 'react-router-dom'

export default function ReportView() {
  const { reportId } = useParams()

  return (
    <div className="public-page">
      <h2>보고서</h2>
      <p>보고서 ID: {reportId}</p>
      <div className="placeholder">준비 중입니다.</div>
    </div>
  )
}
