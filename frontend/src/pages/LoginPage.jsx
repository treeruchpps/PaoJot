import { useState } from 'react';
import { Eye, EyeOff, ShieldUser, KeyRound } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { API_ORIGIN } from '../services/api';

export default function LoginPage({ onSwitch, notice }) {
  const { login, submitting, error, clearError } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const validate = (values) => {
    const next = {};
    const email = values.email.trim();
    if (!email) next.email = 'กรุณากรอกอีเมล';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'รูปแบบอีเมลไม่ถูกต้อง';
    if (!values.password) next.password = 'กรุณากรอกรหัสผ่าน';
    else if (values.password.length < 6) next.password = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
    return next;
  };

  const handleChange = (e) => {
    clearError();
    const next = { ...form, [e.target.name]: e.target.value };
    setForm(next);
    if (submitted) setFieldErrors(validate(next));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const nextErrors = validate(form);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    await login(form.email.trim().toLowerCase(), form.password);
  };

  const inputClass = (hasError, withIcon = false, withRightIcon = false) =>
    `w-full ${withIcon ? 'pl-9' : 'pl-4'} ${withRightIcon ? 'pr-10' : 'pr-4'} py-3 rounded-xl border bg-slate-50 text-slate-700 text-sm focus:outline-none focus:ring-2 transition-all ${
      hasError ? 'border-red-300 focus:ring-red-100 focus:border-red-400' : 'border-slate-200 focus:ring-[#BFD8E4] focus:border-[#2C6488]'
    }`;

  return (
    <div className="min-h-dvh bg-gradient-to-br from-[#EAF3F7] via-white to-[#EAF7E8] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-md">
        <div className="text-center mb-4">
          <img src="/images/Logo_PaoJot.png" alt="PaoJot" className="w-20 h-20 rounded-3xl object-cover mx-auto" />
          <h1 className="text-2xl font-bold text-[#2C6488] leading-tight">PaoJot</h1>
          <p className="text-slate-500 text-sm">จัดการการเงินส่วนตัวได้ง่าย ๆ</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-6 border border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 mb-4">เข้าสู่ระบบ</h2>

          {notice && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2">
              <ShieldUser size={16} color="#10b981" />
              <p className="text-sm text-emerald-700">{notice}</p>
            </div>
          )}

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2">
              <KeyRound size={16} color="#ef4444" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">อีเมล</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <ShieldUser size={16} color="#94a3b8" />
                </div>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  placeholder="your@email.com"
                  aria-invalid={!!fieldErrors.email}
                  className={inputClass(!!fieldErrors.email, true)}
                />
              </div>
              {fieldErrors.email && <p className="mt-1.5 text-xs text-red-500">{fieldErrors.email}</p>}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">รหัสผ่าน</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                  <KeyRound size={16} color="#94a3b8" />
                </div>
                <input
                  type={showPw ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="รหัสผ่านอย่างน้อย 6 ตัว"
                  aria-invalid={!!fieldErrors.password}
                  className={inputClass(!!fieldErrors.password, true, true)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPw ? <Eye size={16} color="currentColor" /> : <EyeOff size={16} color="currentColor" />}
                </button>
              </div>
              {fieldErrors.password && <p className="mt-1.5 text-xs text-red-500">{fieldErrors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full btn-primary text-white py-2.5 rounded-xl font-semibold text-sm mt-1 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
            </button>
          </form>

          <div className="mt-4 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400">หรือ</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            type="button"
            onClick={() => { window.location.href = `${API_ORIGIN}/api/v1/auth/google`; }}
            className="mt-3 w-full flex items-center justify-center gap-3 py-2.5 px-4 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition-all text-sm font-semibold text-slate-700 shadow-sm"
          >
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.1 0 5.8 1.1 8 2.9l6-6C34.5 3.1 29.6 1 24 1 14.8 1 7 6.7 3.7 14.7l7 5.4C12.4 13.8 17.7 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.4 5.7c4.3-4 6.8-9.9 6.8-16.9z"/>
              <path fill="#FBBC05" d="M10.7 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .8-4.4l-7-5.4C2.3 17 1 20.4 1 24s1.3 7 3.7 9.8l7-5.4z"/>
              <path fill="#34A853" d="M24 47c5.6 0 10.3-1.9 13.8-5.1l-7.4-5.7c-1.9 1.3-4.3 2-6.4 2-6.3 0-11.6-4.3-13.5-10.1l-7 5.4C7 41.3 14.8 47 24 47z"/>
            </svg>
            เข้าสู่ระบบด้วย Google
          </button>

          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              ยังไม่มีบัญชี?{' '}
              <button type="button" onClick={onSwitch} className="text-[#2C6488] font-semibold hover:underline">
                สมัครสมาชิก
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
