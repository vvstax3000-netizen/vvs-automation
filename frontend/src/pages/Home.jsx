import { Link } from 'react-router-dom'
import './Home.css'

export default function Home() {
  return (
    <div className="home">
      <div className="home-hero">
        <h1>VVS Marketing Automation</h1>
        <p>광고 대행사를 위한 마케팅 자동화 플랫폼</p>
        <Link to="/dashboard" className="home-cta">대시보드 바로가기</Link>
      </div>
    </div>
  )
}
