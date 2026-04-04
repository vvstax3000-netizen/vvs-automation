import { useParams } from 'react-router-dom'

export default function RankView() {
  const { clientSlug } = useParams()

  return (
    <div className="public-page">
      <h2>순위 현황</h2>
      <p>업체: {clientSlug}</p>
      <div className="placeholder">준비 중입니다.</div>
    </div>
  )
}
