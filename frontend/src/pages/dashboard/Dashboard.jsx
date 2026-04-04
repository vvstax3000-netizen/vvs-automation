export default function Dashboard() {
  return (
    <div className="page">
      <h2>대시보드</h2>
      <p>VVS 마케팅 자동화 관리자 대시보드입니다.</p>
      <div className="dashboard-cards">
        <div className="card">
          <h3>광고주</h3>
          <p className="card-number">-</p>
        </div>
        <div className="card">
          <h3>보고서</h3>
          <p className="card-number">-</p>
        </div>
        <div className="card">
          <h3>이번 달 매출</h3>
          <p className="card-number">-</p>
        </div>
        <div className="card">
          <h3>문의 접수</h3>
          <p className="card-number">-</p>
        </div>
      </div>
    </div>
  )
}
