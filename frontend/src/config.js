// 백엔드 서버 주소.
// 로컬 개발: 비워두면 Vite 프록시(localhost:3001)로 연결됨.
// 배포 환경: Cloudflare Pages 환경변수 VITE_API_URL 에 백엔드 주소를 넣으면 그쪽으로 연결됨.
export const API_BASE = import.meta.env.VITE_API_URL || ''
