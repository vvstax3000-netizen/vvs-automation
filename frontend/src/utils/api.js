// API Base URL 설정
// 개발: '' (Vite 프록시가 localhost:3001로 전달)
// 프로덕션: Workers URL (예: https://vvs-api.your-account.workers.dev)
const API_BASE = import.meta.env.VITE_API_URL || '';

export function apiUrl(path) {
  return `${API_BASE}${path}`;
}

// 인증 헤더 포함 fetch 래퍼
export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const response = await fetch(apiUrl(path), { ...options, headers });
  return response;
}
