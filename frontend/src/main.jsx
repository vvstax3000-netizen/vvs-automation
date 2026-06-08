import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { API_BASE } from './config'

// 배포 환경에서 /api, /uploads 요청을 백엔드 서버(API_BASE)로 자동 연결.
// 로컬에서는 API_BASE가 빈 문자열이라 기존 동작(Vite 프록시) 그대로 유지됨.
if (API_BASE) {
  const _fetch = window.fetch.bind(window)
  window.fetch = (input, init) => {
    if (typeof input === 'string' && (input.startsWith('/api') || input.startsWith('/uploads'))) {
      return _fetch(API_BASE + input, init)
    }
    return _fetch(input, init)
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
