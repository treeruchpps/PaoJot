// ====================================================
// PaoJot — Central API Client
// Base URL: http://localhost:8080/api/v1
// ====================================================

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api/v1';

// ---------- Token helpers ----------
export const getAccessToken  = () => localStorage.getItem('pm_access_token');
export const getRefreshToken = () => localStorage.getItem('pm_refresh_token');
export const setTokens = (access, refresh) => {
  localStorage.setItem('pm_access_token',  access);
  localStorage.setItem('pm_refresh_token', refresh);
};
export const clearTokens = () => {
  localStorage.removeItem('pm_access_token');
  localStorage.removeItem('pm_refresh_token');
  localStorage.removeItem('pm_user');
};

// ---------- Core fetch wrapper ----------
// isFormData = true → ไม่ set Content-Type ให้ browser จัดการ multipart boundary เอง
async function request(path, options = {}, retry = true, isFormData = false) {
  const headers = isFormData ? {} : { 'Content-Type': 'application/json', ...options.headers };
  const token = getAccessToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // 401 → try refresh once
  if (res.status === 401 && retry) {
    const refreshed = await tryRefresh();
    if (refreshed) return request(path, options, false, isFormData);
    clearTokens();
    window.location.href = '/';
    return null;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  // 204 No Content
  if (res.status === 204) return null;
  return res.json();
}

async function tryRefresh() {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  try {
    const res = await fetch(`${BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// ====================================================
// AUTH
// ====================================================
export const auth = {
  register: (body) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  refresh: (refreshToken) =>
    request('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) }),

  changePassword: (body) =>
    request('/auth/change-password', { method: 'PUT', body: JSON.stringify(body) }),
};

// ====================================================
// PROFILE
// ====================================================
export const profile = {
  get:    ()     => request('/profile'),
  update: (body) => request('/profile', { method: 'PUT', body: JSON.stringify(body) }),
};

// ====================================================
// ACCOUNTS
// ====================================================
export const accounts = {
  list:   ()         => request('/accounts'),
  create: (body)     => request('/accounts',     { method: 'POST',   body: JSON.stringify(body) }),
  get:    (id)       => request(`/accounts/${id}`),
  update: (id, body) => request(`/accounts/${id}`, { method: 'PUT',  body: JSON.stringify(body) }),
  delete: (id)       => request(`/accounts/${id}`, { method: 'DELETE' }),
};

// ====================================================
// CATEGORIES
// ====================================================
export const categories = {
  list:   (type)     => request(`/categories${type ? `?type=${type}` : ''}`),
  create: (body)     => request('/categories',     { method: 'POST',   body: JSON.stringify(body) }),
  update: (id, body) => request(`/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id)       => request(`/categories/${id}`, { method: 'DELETE' }),
};

// ====================================================
// TRANSACTIONS
// ====================================================
export const transactions = {
  list: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.account_id) qs.set('account_id', params.account_id);
    if (params.type)       qs.set('type',       params.type);
    if (params.date_from)  qs.set('date_from',  params.date_from);
    if (params.date_to)    qs.set('date_to',    params.date_to);
    if (params.page)       qs.set('page',       params.page);
    if (params.limit)      qs.set('limit',      params.limit);
    const q = qs.toString();
    return request(`/transactions${q ? `?${q}` : ''}`);
  },
  create: (body)     => request('/transactions',     { method: 'POST',   body: JSON.stringify(body) }),
  get:    (id)       => request(`/transactions/${id}`),
  update: (id, body) => request(`/transactions/${id}`, { method: 'PUT',  body: JSON.stringify(body) }),
  delete: (id)       => request(`/transactions/${id}`, { method: 'DELETE' }),
};

// ====================================================
// SAVINGS GOALS
// ====================================================
export const savingsGoals = {
  list:    ()         => request('/savings-goals'),
  create:  (body)     => request('/savings-goals',              { method: 'POST',   body: JSON.stringify(body) }),
  uploadImage: (body) => request('/savings-goals/images',       { method: 'POST',   body }, true, true),
  get:     (id)       => request(`/savings-goals/${id}`),
  update:  (id, body) => request(`/savings-goals/${id}`,        { method: 'PUT',    body: JSON.stringify(body) }),
  delete:  (id)       => request(`/savings-goals/${id}`,        { method: 'DELETE' }),
  deposit: (id, body) => request(`/savings-goals/${id}/deposit`,{ method: 'POST',   body: JSON.stringify(body) }),
};

// ====================================================
// BUDGETS
// ====================================================
export const budgets = {
  list:   ()         => request('/budgets'),
  create: (body)     => request('/budgets',     { method: 'POST',   body: JSON.stringify(body) }),
  get:    (id)       => request(`/budgets/${id}`),
  update: (id, body) => request(`/budgets/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id)       => request(`/budgets/${id}`, { method: 'DELETE' }),
};

// ====================================================
// RECURRING TRANSACTIONS
// ====================================================
export const recurring = {
  list:   ()         => request('/recurring'),
  create: (body)     => request('/recurring',     { method: 'POST',   body: JSON.stringify(body) }),
  update: (id, body) => request(`/recurring/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (id)       => request(`/recurring/${id}`, { method: 'DELETE' }),
};

// ====================================================
// RECEIPT SCANNING (async, single file)
// ====================================================
export const receiptJobs = {
  // อัปโหลดใบเสร็จ 1 ใบ → สร้าง job + background OCR/parse
  create: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/receipt-jobs', { method: 'POST', body: form }, true, true);
  },
  // poll สถานะ + ผลลัพธ์
  get: (jobId) => request(`/receipt-jobs/${jobId}`),
};

// ====================================================
// SLIP SCANNING (batch job)
// ====================================================
export const slipJobs = {
  // Upload 1-5 slip images → creates a job and starts background processing
  create: (files) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return request('/slip-jobs', { method: 'POST', body: form }, true, true);
  },

  // Poll job status + all slip results
  get: (jobId) => request(`/slip-jobs/${jobId}`),

  // List recent jobs
  list: () => request('/slip-jobs'),

  // Confirm a slip result → create transaction
  save: (jobId, resultId, body) =>
    request(`/slip-jobs/${jobId}/results/${resultId}/save`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ====================================================
// NOTIFICATIONS
// ====================================================
export const notifications = {
  list:    ()   => request('/notifications'),
  confirm: (id) => request(`/notifications/${id}/confirm`, { method: 'POST' }),
  skip:    (id) => request(`/notifications/${id}/skip`,    { method: 'POST' }),
  readAll: ()   => request('/notifications/read-all',      { method: 'PUT'  }),
};
