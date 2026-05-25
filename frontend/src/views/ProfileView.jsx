import { useState, useEffect, useRef } from 'react';
import { Camera, X, User, Lock, LogOut, Settings, Sparkles, ShieldCheck, ShieldOff, CalendarDays, KeyRound, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profile as profileApi, auth as authApi } from '../services/api';
import { formatDisplayDate } from '../utils/dateFormat';

const WEEK_START_OPTS = [
  { value: 0, label: 'วันอาทิตย์' },
  { value: 1, label: 'วันจันทร์' },
  { value: 2, label: 'วันอังคาร' },
  { value: 3, label: 'วันพุธ' },
  { value: 4, label: 'วันพฤหัสบดี' },
  { value: 5, label: 'วันศุกร์' },
  { value: 6, label: 'วันเสาร์' },
];

const accent = '#2C6488';

export default function ProfileView() {
  const { user, logout } = useAuth();

  const [profileData, setProfileData] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [aiSummaryEnabled, setAiSummaryEnabled] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');
  const fileInputRef = useRef(null);

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPwForm, setShowPwForm] = useState(false);
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState('');
  const [pwErr, setPwErr] = useState('');

  useEffect(() => {
    (async () => {
      setLoadingProfile(true);
      try {
        const data = await profileApi.get();
        setProfileData(data);
        setDisplayName(data.display_name || '');
        setAvatarUrl(data.avatar_url || '');
        setWeekStartDay(data.week_start_day ?? 1);
        setAiSummaryEnabled(!!data.ai_summary_enabled);
      } catch {
        setProfileErr('โหลดข้อมูลโปรไฟล์ไม่สำเร็จ');
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, []);

  const initials = (profileData?.display_name || user?.username || '?').slice(0, 2).toUpperCase();

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setProfileErr('กรุณาเลือกไฟล์รูปภาพ'); return; }
    if (file.size > 2 * 1024 * 1024) { setProfileErr('ขนาดไฟล์ต้องไม่เกิน 2MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  const saveProfile = async (overrides = {}) => {
    const nextAiEnabled = overrides.aiSummaryEnabled ?? aiSummaryEnabled;
    setSavingProfile(true);
    setProfileMsg('');
    setProfileErr('');
    try {
      const updated = await profileApi.update({
        display_name: displayName.trim() || null,
        avatar_url: avatarUrl || null,
        week_start_day: weekStartDay,
        ai_summary_enabled: nextAiEnabled,
      });
      setProfileData(updated);
      setAvatarUrl(updated.avatar_url || '');
      setAiSummaryEnabled(!!updated.ai_summary_enabled);
      setProfileMsg('บันทึกการตั้งค่าสำเร็จ');
    } catch (err) {
      setProfileErr(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const toggleAiConsent = async (enabled) => {
    setAiSummaryEnabled(enabled);
    await saveProfile({ aiSummaryEnabled: enabled });
  };

  const passwordChecks = [
    { label: 'อย่างน้อย 8 ตัวอักษร', pass: pwForm.next.length >= 8 },
    { label: 'มีตัวเลข', pass: /\d/.test(pwForm.next) },
    { label: 'มีตัวอักษร', pass: /[A-Za-zก-ฮ]/.test(pwForm.next) },
  ];
  const passwordStrength = passwordChecks.filter((item) => item.pass).length;
  const strengthMeta = [
    { label: 'ยังไม่ปลอดภัย', color: '#ef4444', width: '25%' },
    { label: 'พอใช้', color: '#f59e0b', width: '45%' },
    { label: 'ดี', color: '#2C6488', width: '70%' },
    { label: 'แข็งแรง', color: '#10b981', width: '100%' },
  ][passwordStrength];

  const closePasswordForm = () => {
    setShowPwForm(false);
    setPwForm({ current: '', next: '', confirm: '' });
    setPwMsg('');
    setPwErr('');
    setShowPw({ current: false, next: false, confirm: false });
  };

  const changePassword = async () => {
    setPwMsg('');
    setPwErr('');
    if (!pwForm.current || !pwForm.next) { setPwErr('กรุณากรอกรหัสผ่านให้ครบ'); return; }
    if (pwForm.next.length < 8) { setPwErr('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (pwForm.next !== pwForm.confirm) { setPwErr('รหัสผ่านใหม่ไม่ตรงกัน'); return; }
    setSavingPw(true);
    try {
      await authApi.changePassword({ current_password: pwForm.current, new_password: pwForm.next });
      setPwMsg('เปลี่ยนรหัสผ่านสำเร็จ');
      setPwForm({ current: '', next: '', confirm: '' });
      setShowPwForm(false);
    } catch (err) {
      setPwErr(err.message);
    } finally {
      setSavingPw(false);
    }
  };

  const PasswordField = ({ id, label, value, onChange, placeholder }) => (
    <div>
      <label className="text-xs font-medium text-slate-500 mb-1 block">{label}</label>
      <div className="relative">
        <input
          type={showPw[id] ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full border border-slate-200 rounded-xl pl-3 pr-10 py-2.5 text-sm bg-slate-50 text-slate-700 focus:outline-none focus:border-[#BFD8E4]"
        />
        <button
          type="button"
          onClick={() => setShowPw((prev) => ({ ...prev, [id]: !prev[id] }))}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#2C6488]"
        >
          {showPw[id] ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );

  if (loadingProfile) {
    return (
      <div className="p-6 flex items-center justify-center py-32">
        <div className="w-8 h-8 rounded-full border-4 border-[#DCE8EE] border-t-[#2C6488] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="flex items-center gap-5 min-w-0">
            <div className="relative flex-shrink-0 group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-20 h-20 rounded-2xl object-cover border border-[#DCE8EE]" />
              ) : (
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-2xl font-bold" style={{ background: accent }}>
                  {initials}
                </div>
              )}
              <div className="absolute inset-0 rounded-2xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera size={22} color="white" />
              </div>
              {avatarUrl && (
                <button onClick={(e) => { e.stopPropagation(); setAvatarUrl(''); }}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center shadow">
                  <X size={12} color="white" />
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <div className="min-w-0">
              <p className="text-2xl font-bold text-slate-800 truncate">{profileData?.display_name || user?.username}</p>
              <p className="text-sm text-slate-500 mt-1">{user?.email || '-'}</p>
              <p className="text-xs text-slate-400 mt-1">@{user?.username || '-'}</p>
            </div>
          </div>
          <button onClick={logout}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-red-600 bg-red-50 hover:bg-red-100">
            <LogOut size={15} />
            ออกจากระบบ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        <div className="lg:col-span-3 space-y-5">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <User size={16} color={accent} /> ข้อมูลโปรไฟล์
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อผู้ใช้</label>
                <div className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-400">
                  {user?.username || '-'}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500 mb-1 block">อีเมล</label>
                <div className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-400">
                  {user?.email || '-'}
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">ชื่อที่แสดง</label>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                placeholder={user?.username}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-700" />
            </div>

            <button onClick={() => saveProfile()} disabled={savingProfile}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: accent }}>
              {savingProfile ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์'}
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                  <Lock size={18} color={accent} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-700">ความปลอดภัยของบัญชี</h2>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    อัปเดตรหัสผ่านสำหรับเข้าสู่ระบบ ควรใช้รหัสที่ไม่ซ้ำกับเว็บอื่น
                  </p>
                </div>
              </div>
              {!showPwForm && (
                <button
                  type="button"
                  onClick={() => { setShowPwForm(true); setPwMsg(''); setPwErr(''); }}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white flex-shrink-0"
                  style={{ background: accent }}
                >
                  <KeyRound size={14} />
                  เปลี่ยนรหัสผ่าน
                </button>
              )}
            </div>

            {pwMsg && <p className="text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-xl">{pwMsg}</p>}
            {pwErr && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{pwErr}</p>}

            {showPwForm && (
              <div className="space-y-4 pt-2">
                <PasswordField
                  id="current"
                  label="รหัสผ่านปัจจุบัน"
                  value={pwForm.current}
                  onChange={(value) => setPwForm({ ...pwForm, current: value })}
                  placeholder="••••••••"
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <PasswordField
                    id="next"
                    label="รหัสผ่านใหม่"
                    value={pwForm.next}
                    onChange={(value) => setPwForm({ ...pwForm, next: value })}
                    placeholder="อย่างน้อย 8 ตัวอักษร"
                  />
                  <PasswordField
                    id="confirm"
                    label="ยืนยันรหัสผ่านใหม่"
                    value={pwForm.confirm}
                    onChange={(value) => setPwForm({ ...pwForm, confirm: value })}
                    placeholder="พิมพ์รหัสผ่านอีกครั้ง"
                  />
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold text-slate-600">ความแข็งแรงรหัสผ่าน</p>
                    <p className="text-[11px] font-bold" style={{ color: strengthMeta.color }}>{strengthMeta.label}</p>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: strengthMeta.width, background: strengthMeta.color }} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                    {passwordChecks.map((item) => (
                      <div key={item.label} className="flex items-center gap-1.5 text-[11px]">
                        <CheckCircle2 size={12} color={item.pass ? '#10b981' : '#cbd5e1'} />
                        <span className={item.pass ? 'text-slate-600' : 'text-slate-400'}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-1">
                  <button onClick={closePasswordForm}
                    className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50">
                    ยกเลิก
                  </button>
                  <button onClick={changePassword} disabled={savingPw}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: accent }}>
                    {savingPw ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Settings size={16} color={accent} /> ตั้งค่าระบบ
            </h2>

            <div>
              <label className="text-xs font-medium text-slate-500 mb-1 block">วันเริ่มต้นสัปดาห์</label>
              <div className="relative">
                <CalendarDays size={15} className="absolute left-3 top-3 text-slate-400" />
                <select value={weekStartDay} onChange={(e) => setWeekStartDay(parseInt(e.target.value, 10))}
                  className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm bg-slate-50 text-slate-700">
                  {WEEK_START_OPTS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <button onClick={() => saveProfile()} disabled={savingProfile}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: accent }}>
              บันทึกการตั้งค่า
            </button>
          </div>

          <div className={`rounded-2xl shadow-sm border p-6 space-y-4 ${aiSummaryEnabled ? 'bg-[#EAF3F7] border-[#BFD8E4]' : 'bg-white border-slate-100'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <Sparkles size={16} color={accent} />
                <h2 className="text-sm font-semibold text-slate-700">การใช้ข้อมูลกับ AI</h2>
              </div>
              {aiSummaryEnabled ? <ShieldCheck size={18} color="#10b981" /> : <ShieldOff size={18} color="#94a3b8" />}
            </div>

            <div className="space-y-2 text-sm text-slate-600 leading-relaxed">
              <p>เปิดเพื่ออนุญาตให้ระบบส่งข้อมูลธุรกรรมที่จำเป็นไปให้ LLM สำหรับสรุปการเงินรายสัปดาห์และรายเดือน</p>
              <p className="text-xs text-slate-500">ระบบจะใช้ข้อมูลสรุป เช่น รายรับ รายจ่าย หมวดหมู่ งบประมาณ และเป้าหมายการออม ไม่ส่งรูปสลิป รูปใบเสร็จ หรือหมายเหตุส่วนตัวที่ไม่จำเป็น</p>
            </div>

            <div className="rounded-xl bg-white/80 border border-white px-3 py-3">
              <p className="text-xs text-slate-500 mb-1">สถานะปัจจุบัน</p>
              <p className={`text-sm font-bold ${aiSummaryEnabled ? 'text-emerald-600' : 'text-slate-500'}`}>
                {aiSummaryEnabled ? 'ยินยอมให้ใช้ข้อมูลกับ AI' : 'ปิดการใช้ข้อมูลกับ AI'}
              </p>
              {profileData?.ai_summary_consent_at && aiSummaryEnabled && (
                <p className="text-xs text-slate-400 mt-1">ยินยอมเมื่อ {formatDisplayDate(profileData.ai_summary_consent_at)}</p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => toggleAiConsent(true)} disabled={savingProfile || aiSummaryEnabled}
                className="py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: accent }}>
                ยินยอม
              </button>
              <button onClick={() => toggleAiConsent(false)} disabled={savingProfile || !aiSummaryEnabled}
                className="py-2.5 rounded-xl text-sm font-semibold border border-red-200 bg-red-50 text-red-600 disabled:opacity-50">
                ปิดการยินยอม
              </button>
            </div>
          </div>

          {profileMsg && <p className="text-sm text-emerald-600 bg-emerald-50 px-3 py-2 rounded-xl">{profileMsg}</p>}
          {profileErr && <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-xl">{profileErr}</p>}
        </div>
      </div>
    </div>
  );
}
