// Web Crypto API 기반 유틸리티 (Cloudflare Workers 호환)

// HMAC-SHA256 서명 (네이버 검색광고 API용)
export async function hmacSha256(secret, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

// SHA-256 해시 (비밀번호 비교용)
export async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 비밀번호 검증
export async function verifyPassword(inputPassword, storedHash) {
  // storedHash format: "sha256:<hex>"
  if (storedHash.startsWith('sha256:')) {
    const expected = storedHash.slice(7);
    const actual = await sha256(inputPassword);
    return actual === expected;
  }
  // 평문 비교 (마이그레이션 중 임시)
  return inputPassword === storedHash;
}

// 네이버 API 헤더 생성
export async function naverHeaders(method, path, apiLicense, apiSecret, customerId) {
  const timestamp = String(Date.now());
  const message = `${timestamp}.${method}.${path}`;
  const signature = await hmacSha256(apiSecret, message);
  return {
    'X-API-KEY': apiLicense,
    'X-Customer': customerId,
    'X-Timestamp': timestamp,
    'X-Signature': signature
  };
}
