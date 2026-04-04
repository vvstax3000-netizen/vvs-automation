import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import DashboardLayout from './components/DashboardLayout'
import Home from './pages/Home'
import Login from './pages/Login'
import Dashboard from './pages/dashboard/Dashboard'
import ClientList from './pages/clients/ClientList'
import ClientForm from './pages/clients/ClientForm'
import Reports from './pages/reports/Reports'
import RankTracker from './pages/rank-tracker/RankTracker'
import MetaAds from './pages/meta-ads/MetaAds'
import NaverAds from './pages/naver-ads/NaverAds'
import Sales from './pages/sales/Sales'
import CRM from './pages/crm/CRM'
import Rewards from './pages/rewards/Rewards'
import ReportView from './pages/report/ReportView'
import RankView from './pages/rank/RankView'

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/report/:reportId" element={<ReportView />} />
        <Route path="/rank/:clientSlug" element={<RankView />} />

        {/* Protected dashboard routes */}
        <Route path="/dashboard" element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }>
          <Route index element={<Dashboard />} />
          <Route path="clients" element={<ClientList />} />
          <Route path="clients/new" element={<ClientForm />} />
          <Route path="clients/:id/edit" element={<ClientForm />} />
          <Route path="reports" element={<Reports />} />
          <Route path="rank-tracker" element={<RankTracker />} />
          <Route path="meta-ads" element={<MetaAds />} />
          <Route path="naver-ads" element={<NaverAds />} />
          <Route path="sales" element={<Sales />} />
          <Route path="crm" element={<CRM />} />
          <Route path="rewards" element={<Rewards />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}

export default App
