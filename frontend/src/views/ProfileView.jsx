import { useState, useEffect, useRef } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Camera, X, User, Lock, LogOut, Settings, Sparkles, ShieldCheck, ShieldOff, CalendarDays, KeyRound, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { profile as profileApi, auth as authApi } from '../services/api';
import { formatDisplayDate } from '../utils/dateFormat';
import ConfirmDialog from '../components/common/ConfirmDialog';

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
  const { showError, showSuccess } = useSnackbar();
  const { user, logout } = useAuth();

  const [profileData, setProfileData] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [weekStartDay, setWeekStartDay] = useState(1);
  const [aiSummaryEnabled, setAiSummaryEnabled] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const fileInputRef = useRef(null);

  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [showPwForm, setShowPwForm] = useState(false);
  const [showPw, setShowPw] = useState({ current: false, next: false, confirm: false });
  const [savingPw, setSavingPw] = useState(false);

  const [confirmAction, setConfirmAction] = useState(null);

  const handleConfirmAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'logout') {
      setConfirmAction(null);
      logout();
    } else if (confirmAction.type === 'save-profile') {
      const ok = await saveBasicProfile();
      if (ok) setConfirmAction(null);
    } else if (confirmAction.type === 'save-settings') {
      const ok = await saveSystemSettings();
      if (ok) setConfirmAction(null);
    } else if (confirmAction.type === 'enable-ai') {
      setConfirmAction(null);
      await toggleAiConsent(true);
    } else if (confirmAction.type === 'disable-ai') {
      setConfirmAction(null);
      await toggleAiConsent(false);
    }
  };

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
        showError('โหลดข้อมูลโปรไฟล์ไม่สำเร็จ');
      } finally {
        setLoadingProfile(false);
      }
    })();
  }, [showError]);

  const initials = (profileData?.display_name || user?.username || '?').slice(0, 2).toUpperCase();
  const hasBasicProfileChanges =
    (displayName || '') !== (profileData?.display_name || '') ||
    (avatarUrl || '') !== (profileData?.avatar_url || '');
  const hasSystemSettingsChanges = weekStartDay !== (profileData?.week_start_day ?? 1);
  const hasProfileChanges = hasBasicProfileChanges || hasSystemSettingsChanges;

  const resetProfileDraft = () => {
    setDisplayName(profileData?.display_name || '');
    setAvatarUrl(profileData?.avatar_url || '');
    showSuccess('');
    showError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const requestSaveProfile = () => {
    showSuccess('');
    showError('');
    setConfirmAction({ type: 'save-profile' });
  };

  const resetSystemSettingsDraft = () => {
    setWeekStartDay(profileData?.week_start_day ?? 1);
    showSuccess('');
    showError('');
  };

  const requestSaveSystemSettings = () => {
    showSuccess('');
    showError('');
    setConfirmAction({ type: 'save-settings' });
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { showError('กรุณาเลือกไฟล์รูปภาพ'); return; }
    if (file.size > 2 * 1024 * 1024) { showError('ขนาดไฟล์ต้องไม่เกิน 2MB'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarUrl(ev.target.result);
    reader.readAsDataURL(file);
  };

  const saveProfile = async (overrides = {}, options = {}) => {
    const nextDisplayName = overrides.displayName ?? displayName;
    const nextAvatarUrl = overrides.avatarUrl ?? avatarUrl;
    const nextWeekStartDay = overrides.weekStartDay ?? weekStartDay;
    const nextAiEnabled = overrides.aiSummaryEnabled ?? aiSummaryEnabled;
    setSavingProfile(true);
    showSuccess('');
    showError('');
    try {
      const updated = await profileApi.update({
        display_name: nextDisplayName.trim() || null,
        avatar_url: nextAvatarUrl || null,
        week_start_day: nextWeekStartDay,
        ai_summary_enabled: nextAiEnabled,
      });
      setProfileData(updated);
      if (!options.preserveProfileDraft) {
        setDisplayName(updated.display_name || '');
        setAvatarUrl(updated.avatar_url || '');
      }
      if (!options.preserveSettingsDraft) {
        setWeekStartDay(updated.week_start_day ?? 1);
      }
      setAiSummaryEnabled(!!updated.ai_summary_enabled);
      if (!options.preserveProfileDraft && fileInputRef.current) fileInputRef.current.value = '';
      showSuccess(options.successMessage || 'บันทึกการตั้งค่าสำเร็จ');
      return true;
    } catch (err) {
      showError(err.message);
      return false;
    } finally {
      setSavingProfile(false);
    }
  };

  const saveBasicProfile = () => saveProfile(
    {
      weekStartDay: profileData?.week_start_day ?? 1,
      aiSummaryEnabled: !!profileData?.ai_summary_enabled,
    },
    {
      preserveSettingsDraft: true,
      successMessage: 'บันทึกโปรไฟล์สำเร็จ',
    }
  );

  const saveSystemSettings = () => saveProfile(
    {
      displayName: profileData?.display_name || '',
      avatarUrl: profileData?.avatar_url || '',
      aiSummaryEnabled: !!profileData?.ai_summary_enabled,
    },
    {
      preserveProfileDraft: true,
      successMessage: 'บันทึกการตั้งค่าระบบสำเร็จ',
    }
  );

  const toggleAiConsent = async (enabled) => {
    const previous = aiSummaryEnabled;
    setAiSummaryEnabled(enabled);
    const ok = await saveProfile(
      {
        displayName: profileData?.display_name || '',
        avatarUrl: profileData?.avatar_url || '',
        weekStartDay: profileData?.week_start_day ?? 1,
        aiSummaryEnabled: enabled,
      },
      {
        preserveProfileDraft: true,
        preserveSettingsDraft: true,
        successMessage: enabled ? 'เปิดการยินยอมข้อมูล AI สำเร็จ' : 'ปิดการยินยอมข้อมูล AI สำเร็จ',
      }
    );
    if (!ok) setAiSummaryEnabled(previous);
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
    showSuccess('');
    showError('');
    setShowPw({ current: false, next: false, confirm: false });
  };

  const changePassword = async () => {
    showSuccess('');
    showError('');
    if (!pwForm.current || !pwForm.next) { showError('กรุณากรอกรหัสผ่านให้ครบ'); return; }
    if (pwForm.next.length < 8) { showError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร'); return; }
    if (pwForm.next !== pwForm.confirm) { showError('รหัสผ่านใหม่ไม่ตรงกัน'); return; }
    setSavingPw(true);
    try {
      await authApi.changePassword({ current_password: pwForm.current, new_password: pwForm.next });
      showSuccess('เปลี่ยนรหัสผ่านสำเร็จ');
      setPwForm({ current: '', next: '', confirm: '' });
      setShowPwForm(false);
    } catch (err) {
      showError(err.message);
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

  const confirmDialogCopy = (() => {
    switch (confirmAction?.type) {
      case 'logout':
        return {
          title: 'ออกจากระบบ',
          message: 'ต้องการออกจากระบบ PaoJot ใช่ไหม? หากต้องการใช้งานต่อ คุณจะต้องเข้าสู่ระบบใหม่อีกครั้ง',
          confirmText: 'ออกจากระบบ',
          tone: 'danger',
        };
      case 'save-profile':
        return {
          title: 'บันทึกข้อมูลโปรไฟล์',
          message: 'ต้องการบันทึกชื่อที่แสดงและรูปโปรไฟล์ของคุณใช่ไหม?',
          confirmText: 'บันทึกโปรไฟล์',
          tone: 'primary',
          note: 'การตั้งค่าระบบ เช่น วันเริ่มต้นสัปดาห์ จะไม่ถูกบันทึกจากปุ่มนี้',
        };
      case 'save-settings':
        return {
          title: 'บันทึกการตั้งค่าระบบ',
          message: 'ต้องการบันทึกวันเริ่มต้นสัปดาห์สำหรับการสรุปรายสัปดาห์ใช่ไหม?',
          confirmText: 'บันทึกการตั้งค่า',
          tone: 'primary',
          note: 'ข้อมูลโปรไฟล์ เช่น ชื่อและรูป จะไม่ถูกบันทึกจากปุ่มนี้',
        };
      case 'enable-ai':
        return {
          title: 'เปิดการยินยอมข้อมูล AI',
          message: 'ต้องการอนุญาตให้ระบบใช้ข้อมูลทางการเงินที่จำเป็นเพื่อสร้างสรุปรายสัปดาห์และรายเดือนใช่ไหม?',
          confirmText: 'ยืนยันการยินยอม',
          tone: 'primary',
          note: 'สามารถปิดการยินยอมได้ทุกเมื่อจากหน้าโปรไฟล์',
        };
      case 'disable-ai':
      default:
        return {
          title: 'ยกเลิกการยินยอมข้อมูล AI',
          message: 'ต้องการปิดการยินยอมให้ใช้ข้อมูลกับ AI ใช่ไหม? หากปิดแล้ว ระบบจะไม่สามารถสร้างสรุปการเงินรายสัปดาห์และรายเดือนให้คุณได้',
          confirmText: 'ยืนยันปิดการยินยอม',
          tone: 'warning',
        };
    }
  })();

  if (loadingProfile) {
    return (
      <div className="p-6 flex items-center justify-center py-32">
        <div className="w-8 h-8 rounded-full border-4 border-[#DCE8EE] border-t-[#2C6488] animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="relative overflow-hidden rounded-3xl bg-[#EAF3F7] p-6 md:p-8 shadow-sm text-slate-800 border border-[#DCE8EE]">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 relative z-10">
          <div className="flex items-center gap-6 min-w-0">
            <div className="relative flex-shrink-0 group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {avatarUrl ? (
                <div className="p-1 rounded-2xl bg-white shadow-sm border border-[#DCE8EE]">
                  <img src={avatarUrl} alt="avatar" className="w-20 h-20 rounded-xl object-cover border border-[#DCE8EE]" />
                </div>
              ) : (
                <div className="p-1 rounded-2xl bg-white shadow-sm border border-[#DCE8EE]">
                  <div className="w-20 h-20 rounded-xl flex items-center justify-center text-white text-2xl font-bold bg-[#2C6488]/80 shadow-md">
                    {initials}
                  </div>
                </div>
              )}
              <div className="absolute inset-1 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera size={22} color="white" />
              </div>
              {avatarUrl && (
                <button onClick={(e) => { e.stopPropagation(); setAvatarUrl(''); }}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-650 flex items-center justify-center shadow-lg transition-colors border border-white/20">
                  <X size={12} color="white" />
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-extrabold text-slate-800 truncate leading-tight">{profileData?.display_name || user?.username}</h1>
                <Sparkles size={16} className="text-yellow-400 animate-pulse flex-shrink-0" />
              </div>
              <p className="text-slate-500 text-sm mt-1.5 font-medium">{user?.email || '-'}</p>
              <span className="inline-flex mt-2 text-xs px-2.5 py-1 rounded-lg font-bold bg-white text-[#2C6488] border border-[#DCE8EE]">
                @{user?.username || '-'}
              </span>
              {hasProfileChanges && (
                <span className="inline-flex mt-2 ml-2 text-xs px-2.5 py-1 rounded-lg font-bold bg-amber-50 text-amber-700 border border-amber-100">
                  มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก
                </span>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-[#2C6488] border border-[#DCE8EE] hover:bg-[#F6FAFC]"
                >
                  <Camera size={13} />
                  เปลี่ยนรูปโปรไฟล์
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl('')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-red-500 border border-red-100 hover:bg-red-50"
                  >
                    <X size={13} />
                    ลบรูป
                  </button>
                )}
              </div>
            </div>
          </div>
          <button onClick={() => setConfirmAction({ type: 'logout' })}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-bold text-[#2C6488] bg-white hover:bg-[#F6FAFC] border border-[#DCE8EE] transition-all shadow-sm hover:scale-[1.02] active:scale-[0.98]">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={resetProfileDraft} disabled={savingProfile || !hasBasicProfileChanges}
                className="w-full py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-all disabled:opacity-50 active:scale-[0.98]">
                ยกเลิกการแก้ไข
              </button>
              <button onClick={requestSaveProfile} disabled={savingProfile || !hasBasicProfileChanges}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:bg-[#25536F] disabled:opacity-50 active:scale-[0.98] shadow-sm bg-[#2C6488]">
                {savingProfile ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์'}
              </button>
            </div>
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
                  onClick={() => { setShowPwForm(true); showSuccess(''); showError(''); }}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-white flex-shrink-0"
                  style={{ background: accent }}
                >
                  <KeyRound size={14} />
                  เปลี่ยนรหัสผ่าน
                </button>
              )}
            </div>

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button onClick={resetSystemSettingsDraft} disabled={savingProfile || !hasSystemSettingsChanges}
                className="w-full py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-all disabled:opacity-50 active:scale-[0.98]">
                ยกเลิกการแก้ไข
              </button>
              <button onClick={requestSaveSystemSettings} disabled={savingProfile || !hasSystemSettingsChanges}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:bg-[#25536F] disabled:opacity-50 active:scale-[0.98] shadow-sm bg-[#2C6488]">
                บันทึกการตั้งค่า
              </button>
            </div>
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
              <p>เปิดเพื่ออนุญาตให้ระบบส่งข้อมูลธุรกรรมที่จำเป็นไปให้ AI สำหรับสรุปการเงินรายสัปดาห์และรายเดือน</p>
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
              <button onClick={() => setConfirmAction({ type: 'enable-ai' })} disabled={savingProfile || aiSummaryEnabled}
                className="py-2.5 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-1.5 shadow-sm active:scale-[0.98]"
                style={{ background: accent }}>
                ยินยอม
              </button>
              <button 
                onClick={() => setConfirmAction({ type: 'disable-ai' })} 
                disabled={savingProfile || !aiSummaryEnabled}
                className="py-2.5 rounded-xl text-sm font-bold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-all disabled:opacity-50 active:scale-[0.98]"
              >
                ปิดการยินยอม
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={!!confirmAction}
        title={confirmDialogCopy.title}
        message={confirmDialogCopy.message}
        confirmText={confirmDialogCopy.confirmText}
        cancelText="ยกเลิก"
        tone={confirmDialogCopy.tone}
        note={confirmDialogCopy.note}
        loading={savingProfile && ['save-profile', 'save-settings'].includes(confirmAction?.type)}
        onConfirm={handleConfirmAction}
        onClose={() => setConfirmAction(null)}
      />
    </div>
  );
}
