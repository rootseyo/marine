import { cookies } from 'next/headers';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:8080';

// 서버 컴포넌트용 fetch 함수
export async function serverFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const cookieStore = await cookies();
  const token = cookieStore.get('token')?.value;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
    cache: 'no-store', // 항상 최신 데이터 (SSR)
  });

  if (!res.ok) {
    // 404 errors are often expected (e.g. empty lists), so we suppress the log.
    if (res.status !== 404 && res.status !== 500) {
      console.error(`API Error ${res.status} for ${endpoint}`);
    }
     // throw new Error(`API Error: ${res.status}`);
     // 임시: 에러 시 null 또는 빈 값 반환을 위해 에러를 던지고 호출부에서 처리하도록 유도
     throw new Error(`Failed to fetch ${endpoint} (Status: ${res.status}): ${res.statusText}`);
  }

  return res.json();
}
