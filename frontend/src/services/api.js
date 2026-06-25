// ====================================================
// PaoJot — Central API Client
// Base URL: http://localhost:8080/api/v1
// ====================================================

const BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080/api/v1';
export const API_ORIGIN = BASE_URL.replace(/\/api\/v1\/?$/, '');

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
  const isPublicAuthRequest = path.startsWith('/auth/login') || path.startsWith('/auth/register') || path.startsWith('/auth/refresh');

  // 401 → try refresh once
  if (res.status === 401 && retry && !isPublicAuthRequest) {
    const refreshed = await tryRefresh();
    if (refreshed) return request(path, options, false, isFormData);
    clearTokens();
    window.location.href = '/';
    return null;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const apiError = new Error(err.error || `HTTP ${res.status}`);
    apiError.status = res.status;
    throw apiError;
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
    if (params.search)     qs.set('search',     params.search);
    if (params.sort_by)    qs.set('sort_by',    params.sort_by);
    if (params.sort_dir)   qs.set('sort_dir',   params.sort_dir);
    if (params.include_goal) qs.set('include_goal', 'true');
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
  delete:  (id, refundAccountId) => {
    const q = refundAccountId ? `?refund_account_id=${refundAccountId}` : '';
    return request(`/savings-goals/${id}${q}`, { method: 'DELETE' });
  },
  addInitialBalance: (id, body) => request(`/savings-goals/${id}/initial-balance`, { method: 'POST', body: JSON.stringify(body) }),
  deposit:  (id, body) => request(`/savings-goals/${id}/deposit`, { method: 'POST', body: JSON.stringify(body) }),
  withdraw: (id, body) => request(`/savings-goals/${id}/withdraw`,{ method: 'POST', body: JSON.stringify(body) }),
};

// ====================================================
// BUDGETS
// ====================================================
export const budgets = {
  list:   (type)     => request(`/budgets${type && type !== 'all' ? `?type=${type}` : ''}`),
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
// UNIFIED DOCUMENT SCANNING (receipt/slip auto classify)
// ====================================================
export const scanJobs = {
  create: (files) => {
    const form = new FormData();
    const list = Array.isArray(files) ? files : [files];
    list.forEach((f) => form.append('files', f));
    return request('/scan-jobs', { method: 'POST', body: form }, true, true);
  },
  get: (jobId) => request(`/scan-jobs/${jobId}`),
  list: () => request('/scan-jobs'),
  cancel: (jobId) => request(`/scan-jobs/${jobId}/cancel`, { method: 'POST' }),
  save: (jobId, resultId) => request(`/scan-jobs/${jobId}/results/${resultId}/save`, { method: 'POST' }),
  saveSlip: (jobId, resultId, body) =>
    request(`/scan-jobs/${jobId}/results/${resultId}/save-slip`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  skip: (jobId, resultId) => request(`/scan-jobs/${jobId}/results/${resultId}/skip`, { method: 'POST' }),
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

// ====================================================
// AI FINANCIAL SUMMARY
// ====================================================
export const aiSummary = {
  get: (periodType = 'monthly') =>
    request(`/ai-summary?period_type=${encodeURIComponent(periodType)}`),
  eligibility: () => request('/ai-summary/eligibility'),
  generate: (periodType = 'monthly') =>
    request('/ai-summary', {
      method: 'POST',
      body: JSON.stringify({ period_type: periodType }),
    }),
};

// ====================================================
// QUICK ENTRY ASSISTANT
// ====================================================
export const quickEntry = {
  parse: (body, signal) =>
    request('/quick-entry/parse', {
      method: 'POST',
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    }),
  getChatLog: (mode) =>
    request(`/quick-entry/chat-log?mode=${encodeURIComponent(mode)}`),
  saveChatLog: (mode, messages) =>
    request('/quick-entry/chat-log', {
      method: 'PUT',
      body: JSON.stringify({ mode, messages }),
    }),
  clearChatLog: (mode) =>
    request(`/quick-entry/chat-log?mode=${encodeURIComponent(mode)}`, {
      method: 'DELETE',
    }),
};
