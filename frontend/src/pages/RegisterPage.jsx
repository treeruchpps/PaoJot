import { useState } from 'react';
import { Shield, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const WEEK_DAYS = [
  { value: 0, label: 'วันอาทิตย์' },
  { value: 1, label: 'วันจันทร์' },
  { value: 2, label: 'วันอังคาร' },
  { value: 3, label: 'วันพุธ' },
  { value: 4, label: 'วันพฤหัสบดี' },
  { value: 5, label: 'วันศุกร์' },
  { value: 6, label: 'วันเสาร์' },
];

export default function RegisterPage({ onSwitch, onRegisterSuccess }) {
  const { register, submitting, error, clearError } = useAuth();
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    week_start_day: 0,
  });
  const [showPw, setShowPw] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const validate = (values) => {
    const next = {};
    const username = values.username.trim();
    const email = values.email.trim();
    if (!username) next.username = 'กรุณากรอกชื่อผู้ใช้';
    else if (username.length < 3) next.username = 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร';
    if (!email) next.email = 'กรุณากรอกอีเมล';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'รูปแบบอีเมลไม่ถูกต้อง';
    if (!values.password) next.password = 'กรุณากรอกรหัสผ่าน';
    else if (values.password.length < 6) next.password = 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร';
    if (!values.confirmPassword) next.confirmPassword = 'กรุณายืนยันรหัสผ่าน';
    else if (values.password !== values.confirmPassword) next.confirmPassword = 'รหัสผ่านไม่ตรงกัน';
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

    const res = await register({
      username: form.username.trim(),
      email: form.email.trim().toLowerCase(),
      password: form.password,
      week_start_day: form.week_start_day,
    });
    if (res?.success) onRegisterSuccess?.();
  };

  const inputClass = (hasError, withRightIcon = false) =>
    `w-full px-4 ${withRightIcon ? 'pr-10' : ''} py-3 rounded-xl border bg-slate-50 text-slate-700 text-sm focus:outline-none focus:ring-2 transition-all ${
      hasError ? 'border-red-300 focus:ring-red-100 focus:border-red-400' : 'border-slate-200 focus:ring-[#BFD8E4] focus:border-[#2C6488]'
    }`;

  return (
    <div className="min-h-dvh bg-gradient-to-br from-[#EAF3F7] via-white to-[#EAF7E8] flex items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-4">
          <img src="/images/Logo_PaoJot.png" alt="PaoJot" className="w-20 h-20 rounded-3xl object-cover mx-auto" />
          <h1 className="text-2xl font-bold text-[#2C6488] leading-tight">PaoJot</h1>
          <p className="text-slate-500 text-sm">เริ่มต้นจัดการการเงินของคุณ</p>
        </div>

        <div className="bg-white rounded-3xl shadow-xl p-6 border border-slate-100">
          <h2 className="text-xl font-bold text-slate-800 mb-4">สมัครสมาชิก</h2>

          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2">
              <Shield size={16} color="#ef4444" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">ชื่อผู้ใช้</label>
              <input
                type="text"
                name="username"
                value={form.username}
                onChange={handleChange}
                placeholder="ชื่อที่ต้องการแสดง"
                maxLength={50}
                aria-invalid={!!fieldErrors.username}
                className={inputClass(!!fieldErrors.username)}
              />
              {fieldErrors.username && <p className="mt-1.5 text-xs text-red-500">{fieldErrors.username}</p>}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">อีเมล</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={handleChange}
                placeholder="your@email.com"
                aria-invalid={!!fieldErrors.email}
                className={inputClass(!!fieldErrors.email)}
              />
              {fieldErrors.email && <p className="mt-1.5 text-xs text-red-500">{fieldErrors.email}</p>}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">รหัสผ่าน</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  name="password"
                  value={form.password}
                  onChange={handleChange}
                  placeholder="อย่างน้อย 6 ตัวอักษร"
                  aria-invalid={!!fieldErrors.password}
                  className={inputClass(!!fieldErrors.password, true)}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPw ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
              </div>
              {fieldErrors.password && <p className="mt-1.5 text-xs text-red-500">{fieldErrors.password}</p>}
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1.5 block">ยืนยันรหัสผ่าน</label>
              <input
                type={showPw ? 'text' : 'password'}
                name="confirmPassword"
                value={form.confirmPassword}
                onChange={handleChange}
                placeholder="พิมพ์รหัสผ่านอีกครั้ง"
                aria-invalid={!!fieldErrors.confirmPassword}
                className={inputClass(!!fieldErrors.confirmPassword)}
              />
              {fieldErrors.confirmPassword && <p className="mt-1.5 text-xs text-red-500">{fieldErrors.confirmPassword}</p>}
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-slate-500 mb-2 block">
                วันเริ่มต้นสัปดาห์
                <span className="ml-1 font-normal text-slate-400">(ใช้แสดงสรุปรายสัปดาห์)</span>
              </label>
              <select
                value={form.week_start_day}
                onChange={(e) => setForm({ ...form, week_start_day: parseInt(e.target.value, 10) })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-[#BFD8E4] focus:border-[#2C6488] transition-all"
              >
                {WEEK_DAYS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="sm:col-span-2 w-full btn-primary text-white py-2.5 rounded-xl font-semibold text-sm mt-1 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
            >
              {submitting ? 'กำลังสมัคร...' : 'สมัครสมาชิก'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500">
              มีบัญชีแล้ว?{' '}
              <button type="button" onClick={onSwitch} className="text-[#2C6488] font-semibold hover:underline">
                เข้าสู่ระบบ
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
