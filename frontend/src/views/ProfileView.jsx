import { useState, useEffect, useRef } from 'react';
import { useSnackbar } from '../contexts/SnackbarContext';
import { Camera, X, User, Lock, LogOut, Settings, Sparkles, ShieldCheck, ShieldOff, CalendarDays, KeyRound, Eye, EyeOff, CheckCircle2, AtSign, Mail } from 'lucide-react';
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const requestSaveProfile = () => setConfirmAction({ type: 'save-profile' });

  const resetSystemSettingsDraft = () => {
    setWeekStartDay(profileData?.week_start_day ?? 1);
  };

  const requestSaveSystemSettings = () => setConfirmAction({ type: 'save-settings' });

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
    setShowPw({ current: false, next: false, confirm: false });
  };

  const changePassword = async () => {
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

  const labelCls = 'text-xs font-medium text-slate-500 mb-1.5 block';
  const inputCls = 'w-full border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-50 text-slate-700 focus:outline-none focus:bg-white focus:border-[#2C6488] focus:ring-2 focus:ring-[#2C6488]/10 transition-colors';
  const cardCls = 'bg-white rounded-2xl border border-slate-200/70 shadow-sm';

  // Plain render helper (NOT a component) so inputs keep focus while typing
  const pwField = (id, label, value, onChange, placeholder) => (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="relative">
        <input
          type={showPw[id] ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputCls} pr-10`}
        />
        <button
          type="button"
          onClick={() => setShowPw((prev) => ({ ...prev, [id]: !prev[id] }))}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#2C6488] transition-colors"
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
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className={`${cardCls} p-6 md:p-7`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
          <div className="flex items-center gap-5 min-w-0">
            <div className="relative flex-shrink-0 group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-20 h-20 rounded-2xl object-cover border border-slate-200" />
              ) : (
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-2xl font-bold bg-[#2C6488]">
                  {initials}
                </div>
              )}
              <div className="absolute inset-0 rounded-2xl bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera size={20} color="white" />
              </div>
              {avatarUrl && (
                <button
                  onClick={(e) => { e.stopPropagation(); setAvatarUrl(''); }}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow border-2 border-white transition-colors"
                >
                  <X size={11} color="white" />
                </button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-slate-800 truncate leading-tight">
                {profileData?.display_name || user?.username}
              </h1>
              <p className="text-sm text-slate-500 mt-1 truncate flex items-center gap-1.5">
                <Mail size={13} className="text-slate-400 flex-shrink-0" />
                {user?.email || '-'}
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg font-semibold bg-[#EAF3F7] text-[#2C6488] border border-[#DCE8EE]">
                  <AtSign size={12} />{user?.username || '-'}
                </span>
                {hasProfileChanges && (
                  <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    มีการเปลี่ยนแปลงที่ยังไม่บันทึก
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => setConfirmAction({ type: 'logout' })}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-red-600 bg-white hover:bg-red-50 border border-slate-200 hover:border-red-200 transition-colors flex-shrink-0 self-start sm:self-auto"
          >
            <LogOut size={15} />
            ออกจากระบบ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* ── Left column ────────────────────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-6">

          {/* Profile info */}
          <div className={cardCls}>
            <div className="flex items-center gap-3 p-5 border-b border-slate-100">
              <div className="w-9 h-9 rounded-xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                <User size={17} color={accent} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-800">ข้อมูลโปรไฟล์</h2>
                <p className="text-xs text-slate-400 mt-0.5">จัดการชื่อที่แสดงและรูปโปรไฟล์ของคุณ</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>ชื่อผู้ใช้</label>
                  <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-100/60 text-slate-500">
                    <AtSign size={14} className="text-slate-400 flex-shrink-0" />
                    <span className="truncate">{user?.username || '-'}</span>
                  </div>
                </div>
                <div>
                  <label className={labelCls}>อีเมล</label>
                  <div className="flex items-center gap-2 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm bg-slate-100/60 text-slate-500">
                    <Mail size={14} className="text-slate-400 flex-shrink-0" />
                    <span className="truncate">{user?.email || '-'}</span>
                  </div>
                </div>
              </div>

              <div>
                <label className={labelCls}>ชื่อที่แสดง</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={user?.username}
                  className={inputCls}
                />
                <p className="text-[11px] text-slate-400 mt-1.5">ชื่อนี้จะแสดงบนแดชบอร์ดและรายงานสรุปต่าง ๆ</p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={resetProfileDraft}
                  disabled={savingProfile || !hasBasicProfileChanges}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 active:scale-[0.98]"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={requestSaveProfile}
                  disabled={savingProfile || !hasBasicProfileChanges}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#2C6488] hover:bg-[#25536F] transition-colors disabled:opacity-50 active:scale-[0.98] shadow-sm"
                >
                  {savingProfile ? 'กำลังบันทึก...' : 'บันทึกโปรไฟล์'}
                </button>
              </div>
            </div>
          </div>

          {/* Security */}
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3 p-5 border-b border-slate-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                  <Lock size={17} color={accent} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-800">ความปลอดภัยของบัญชี</h2>
                  <p className="text-xs text-slate-400 mt-0.5">อัปเดตรหัสผ่านสำหรับเข้าสู่ระบบ</p>
                </div>
              </div>
              {!showPwForm && (
                <button
                  type="button"
                  onClick={() => setShowPwForm(true)}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-[#2C6488] bg-[#EAF3F7] hover:bg-[#DCE8EE] border border-[#DCE8EE] transition-colors flex-shrink-0"
                >
                  <KeyRound size={14} />
                  เปลี่ยนรหัสผ่าน
                </button>
              )}
            </div>

            {showPwForm ? (
              <div className="p-5 space-y-4">
                {pwField('current', 'รหัสผ่านปัจจุบัน', pwForm.current, (v) => setPwForm({ ...pwForm, current: v }), '••••••••')}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {pwField('next', 'รหัสผ่านใหม่', pwForm.next, (v) => setPwForm({ ...pwForm, next: v }), 'อย่างน้อย 8 ตัวอักษร')}
                  {pwField('confirm', 'ยืนยันรหัสผ่านใหม่', pwForm.confirm, (v) => setPwForm({ ...pwForm, confirm: v }), 'พิมพ์รหัสผ่านอีกครั้ง')}
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[11px] font-semibold text-slate-600">ความแข็งแรงรหัสผ่าน</p>
                    <p className="text-[11px] font-bold" style={{ color: strengthMeta.color }}>{strengthMeta.label}</p>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: strengthMeta.width, background: strengthMeta.color }} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 pt-0.5">
                    {passwordChecks.map((item) => (
                      <div key={item.label} className="flex items-center gap-1.5 text-[11px]">
                        <CheckCircle2 size={12} color={item.pass ? '#10b981' : '#cbd5e1'} />
                        <span className={item.pass ? 'text-slate-600' : 'text-slate-400'}>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={closePasswordForm}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors active:scale-[0.98]"
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={changePassword}
                    disabled={savingPw}
                    className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#2C6488] hover:bg-[#25536F] transition-colors disabled:opacity-60 active:scale-[0.98] shadow-sm"
                  >
                    {savingPw ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-5">
                <p className="text-xs text-slate-400 leading-relaxed">
                  เพื่อความปลอดภัย ควรใช้รหัสผ่านที่ไม่ซ้ำกับเว็บไซต์อื่น และเปลี่ยนเป็นระยะ
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Right column ───────────────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* System settings */}
          <div className={cardCls}>
            <div className="flex items-center gap-3 p-5 border-b border-slate-100">
              <div className="w-9 h-9 rounded-xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                <Settings size={17} color={accent} />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-800">ตั้งค่าระบบ</h2>
                <p className="text-xs text-slate-400 mt-0.5">ค่าที่ใช้คำนวณรายงานสรุป</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className={labelCls}>วันเริ่มต้นสัปดาห์</label>
                <div className="relative">
                  <CalendarDays size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select
                    value={weekStartDay}
                    onChange={(e) => setWeekStartDay(parseInt(e.target.value, 10))}
                    className={`${inputCls} pl-9 appearance-none cursor-pointer`}
                  >
                    {WEEK_START_OPTS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">ใช้กำหนดช่วงของสรุปการเงินรายสัปดาห์</p>
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={resetSystemSettingsDraft}
                  disabled={savingProfile || !hasSystemSettingsChanges}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-colors disabled:opacity-50 active:scale-[0.98]"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={requestSaveSystemSettings}
                  disabled={savingProfile || !hasSystemSettingsChanges}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-[#2C6488] hover:bg-[#25536F] transition-colors disabled:opacity-50 active:scale-[0.98] shadow-sm"
                >
                  บันทึก
                </button>
              </div>
            </div>
          </div>

          {/* AI consent */}
          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3 p-5 border-b border-slate-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-[#EAF3F7] flex items-center justify-center flex-shrink-0">
                  <Sparkles size={17} color={accent} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-slate-800">การใช้ข้อมูลกับ AI</h2>
                  <p className="text-xs text-slate-400 mt-0.5">สำหรับสรุปการเงินอัตโนมัติ</p>
                </div>
              </div>
              {aiSummaryEnabled
                ? <ShieldCheck size={18} color="#10b981" className="flex-shrink-0" />
                : <ShieldOff size={18} color="#94a3b8" className="flex-shrink-0" />}
            </div>

            <div className="p-5 space-y-4">
              <div className="space-y-2 text-sm text-slate-600 leading-relaxed">
                <p>เปิดเพื่ออนุญาตให้ระบบส่งข้อมูลธุรกรรมที่จำเป็นไปให้ AI สำหรับสรุปการเงินรายสัปดาห์และรายเดือน</p>
                <p className="text-xs text-slate-500">ระบบจะใช้ข้อมูลสรุป เช่น รายรับ รายจ่าย หมวดหมู่ งบประมาณ และเป้าหมายการออม ไม่ส่งรูปสลิป รูปใบเสร็จ หรือหมายเหตุส่วนตัวที่ไม่จำเป็น</p>
              </div>

              <div className={`rounded-xl px-3.5 py-3 border ${aiSummaryEnabled ? 'bg-emerald-50 border-emerald-100' : 'bg-slate-50 border-slate-100'}`}>
                <p className="text-xs text-slate-500 mb-1">สถานะปัจจุบัน</p>
                <p className={`text-sm font-bold ${aiSummaryEnabled ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {aiSummaryEnabled ? 'ยินยอมให้ใช้ข้อมูลกับ AI' : 'ปิดการใช้ข้อมูลกับ AI'}
                </p>
                {profileData?.ai_summary_consent_at && aiSummaryEnabled && (
                  <p className="text-xs text-slate-400 mt-1">ยินยอมเมื่อ {formatDisplayDate(profileData.ai_summary_consent_at)}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setConfirmAction({ type: 'enable-ai' })}
                  disabled={savingProfile || aiSummaryEnabled}
                  className="py-2.5 rounded-xl text-sm font-semibold text-white bg-[#2C6488] hover:bg-[#25536F] transition-colors disabled:opacity-50 active:scale-[0.98] shadow-sm"
                >
                  ยินยอม
                </button>
                <button
                  onClick={() => setConfirmAction({ type: 'disable-ai' })}
                  disabled={savingProfile || !aiSummaryEnabled}
                  className="py-2.5 rounded-xl text-sm font-semibold border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 transition-colors disabled:opacity-50 active:scale-[0.98]"
                >
                  ปิดการยินยอม
                </button>
              </div>
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
