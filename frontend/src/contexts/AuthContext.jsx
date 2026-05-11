import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth as authApi, profile as profileApi, setTokens, clearTokens, getAccessToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(() => {
    try { return JSON.parse(localStorage.getItem('pm_user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const isAuthenticated = !!user && !!getAccessToken();

  const clearError = () => setError(null);

  // รับ token จาก Google OAuth callback URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const oauthError   = params.get('error');

    if (oauthError) {
      setError('เข้าสู่ระบบด้วย Google ไม่สำเร็จ');
      window.history.replaceState({}, '', '/');
      return;
    }

    if (accessToken && refreshToken) {
      setLoading(true);
      setTokens(accessToken, refreshToken);
      // ดึงข้อมูล user จาก token (decode หรือเรียก /profile)
      profileApi.get().then((profile) => {
        const userData = { id: profile.user_id, username: profile.display_name || '', email: '' };
        localStorage.setItem('pm_user', JSON.stringify(userData));
        setUser(userData);
      }).catch(() => {
        // fallback: set minimal user object
        setUser({ id: '', username: '', email: '' });
      }).finally(() => {
        setLoading(false);
        window.history.replaceState({}, '', '/');
      });
    }
  }, []);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const data = await authApi.login({ email, password });
      setTokens(data.access_token, data.refresh_token);
      localStorage.setItem('pm_user', JSON.stringify(data.user));
      setUser(data.user);
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async ({ username, email, password, week_start_day }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await authApi.register({ username, email, password, week_start_day });
      setTokens(data.access_token, data.refresh_token);
      localStorage.setItem('pm_user', JSON.stringify(data.user));
      setUser(data.user);
      return { success: true };
    } catch (err) {
      setError(err.message);
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, loading, error, clearError, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
