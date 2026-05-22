import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { auth as authApi, profile as profileApi, setTokens, clearTokens, getAccessToken } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState(null);

  const isAuthenticated = !!user && !!getAccessToken();

  const clearError = () => setError(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('access_token') || params.get('refresh_token') || params.get('error')) return;

    const token = getAccessToken();
    if (!token) {
      clearTokens();
      setUser(null);
      setLoading(false);
      return;
    }

    profileApi.get().then((profile) => {
      const saved = JSON.parse(localStorage.getItem('pm_user') || 'null');
      const userData = saved || { id: profile.user_id, username: profile.display_name || '', email: '' };
      localStorage.setItem('pm_user', JSON.stringify(userData));
      setUser(userData);
    }).catch(() => {
      clearTokens();
      setUser(null);
    }).finally(() => {
      setLoading(false);
    });
  }, []);

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
    } else if (!getAccessToken()) {
      setLoading(false);
    }
  }, []);

  const formatAuthError = (message) => {
    const text = String(message || '').toLowerCase();
    if (text.includes('invalid email or password')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
    if (text.includes('email or username already exists')) return 'อีเมลหรือชื่อผู้ใช้นี้ถูกใช้แล้ว';
    if (text.includes('required')) return 'กรุณากรอกข้อมูลให้ครบถ้วน';
    if (text.includes('email')) return 'รูปแบบอีเมลไม่ถูกต้อง';
    if (text.includes('min')) return 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
    if (text.includes('failed to fetch')) return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง';
    return message || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
  };

  const login = useCallback(async (email, password) => {
    setSubmitting(true);
    setError(null);
    try {
      const data = await authApi.login({ email, password });
      setTokens(data.access_token, data.refresh_token);
      localStorage.setItem('pm_user', JSON.stringify(data.user));
      setUser(data.user);
      return { success: true };
    } catch (err) {
      const message = formatAuthError(err.message);
      setError(message);
      return { success: false, error: message };
    } finally {
      setSubmitting(false);
    }
  }, []);

  const register = useCallback(async ({ username, email, password, week_start_day }) => {
    setSubmitting(true);
    setError(null);
    try {
      await authApi.register({ username, email, password, week_start_day });
      clearTokens();
      setUser(null);
      return { success: true };
    } catch (err) {
      const message = formatAuthError(err.message);
      setError(message);
      return { success: false, error: message };
    } finally {
      setSubmitting(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, loading, submitting, error, clearError, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
