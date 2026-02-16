export interface User {
  id: number;
  google_id: string;
  email: string;
  name: string | null;
  created_at: string;
}

export interface Organization {
  id: number;
  name: string;
  owner_id: number;
  created_at: string;
  owner?: User;
  sites?: Site[];
}

export interface OrganizationMember {
  id: number;
  organization_id: number;
  user_id: number;
  role: string;
  joined_at: string;
  user?: User;
}

export interface Site {
  id: number;
  organization_id: number | null;
  url: string;
  api_key: string;
  seo_score: number | null;
  created_at: string;
  deleted_at: string | null;
  organization?: Organization;
}

// API 호출 헬퍼 함수
async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `API Error: ${res.status}`);
  }

  const text = await res.text();
  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    console.warn('Failed to parse JSON response:', err);
    return {} as T;
  }
}

export const api = {
  organizations: {
    list: () => fetchApi<Organization[]>('/api/admin/organizations'),
    getSites: (orgId: number) => fetchApi<Site[]>(`/api/admin/organizations/${orgId}/sites`),
    getMembers: (orgId: number) => fetchApi<OrganizationMember[]>(`/api/admin/organizations/${orgId}/members`),
  },
  users: {
    search: (keyword: string) => fetchApi<User[]>(`/api/admin/users?keyword=${encodeURIComponent(keyword)}`),
    get: (userId: number) => fetchApi<User>(`/api/admin/users/${userId}`),
  },
  sites: {
    list: () => fetchApi<Site[]>('/api/admin/sites'),
  }
};