import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Sidebar.css'

const menuItems = [
  { path: '/dashboard', label: '대시보드', end: true },
  { path: '/dashboard/clients', label: '광고주 관리' },
  { path: '/dashboard/reports', label: '보고서 관리' },
  { path: '/dashboard/rank-tracker', label: '플레이스 순위 추적' },
  { path: '/dashboard/meta-ads', label: '메타 광고' },
  { path: '/dashboard/naver-ads', label: '네이버 검색광고' },
  { path: '/dashboard/sales', label: '매출 데이터' },
  { path: '/dashboard/crm', label: 'CRM' },
  { path: '/dashboard/rewards', label: '리워드 관리' },
]

export default function Sidebar() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>VVS</h1>
        <span>Marketing Automation</span>
      </div>
      <nav className="sidebar-nav">
        {menuItems.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-footer">
        <button onClick={handleLogout} className="logout-btn">로그아웃</button>
      </div>
    </aside>
  )
}
