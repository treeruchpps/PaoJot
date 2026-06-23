// ====================================================
// PaoJot — Category icon/color resolver (frontend source of truth)
// icon/color ของหมวดหมู่ถูกย้ายออกจากฐานข้อมูลมาไว้ที่นี่
//   - หมวดเริ่มต้น (default)  → ใช้ค่าจาก DEFAULT_CATEGORY_STYLES (key = "<type>:<name>")
//   - หมวดที่ผู้ใช้สร้างเอง    → กำหนดอัตโนมัติแบบ deterministic จากชื่อ (ไอคอน Tag + สีจาก palette)
// ====================================================

const FALLBACK_COLOR = '#94a3b8';
const FALLBACK_ICON  = 'Tag';

// สีสำหรับหมวดที่ผู้ใช้สร้างเอง (เลือกตาม hash ของชื่อ)
const CUSTOM_PALETTE = [
  '#2C6488', '#10b981', '#f59e0b', '#ef4444', '#ec4899',
  '#5F9A7A', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
  '#8b5cf6', '#3b82f6',
];

// ค่าเดิมที่เคย seed อยู่ใน DB — ย้ายมาไว้ฝั่ง frontend
export const DEFAULT_CATEGORY_STYLES = {
  // ── รายจ่าย (expense) ──
  'expense:อาหาร':        { icon: 'UtensilsCrossed',  color: '#f97316' },
  'expense:เดินทาง':      { icon: 'Car',              color: '#3b82f6' },
  'expense:ของใช้':       { icon: 'Package',          color: '#64748b' },
  'expense:ช้อปปิ้ง':     { icon: 'ShoppingBag',      color: '#ec4899' },
  'expense:บันเทิง':      { icon: 'Gamepad2',         color: '#8b5cf6' },
  'expense:ที่อยู่อาศัย': { icon: 'Home',             color: '#84cc16' },
  'expense:ชำระบิล':      { icon: 'ReceiptText',      color: '#06b6d4' },
  'expense:สุขภาพ':       { icon: 'HeartPulse',       color: '#10b981' },
  'expense:ครอบครัว':     { icon: 'Users',            color: '#f59e0b' },
  'expense:สัตว์เลี้ยง':  { icon: 'PawPrint',         color: '#5F9A7A' },
  'expense:ของขวัญ':      { icon: 'Gift',             color: '#f59e0b' },
  'expense:การบริจาค':    { icon: 'HandHeart',        color: '#ef4444' },
  'expense:การศึกษา':     { icon: 'GraduationCap',    color: '#6366f1' },
  'expense:ท่องเที่ยว':   { icon: 'Plane',            color: '#2C6488' },
  'expense:งาน':          { icon: 'BriefcaseBusiness', color: '#475569' },
  'expense:ลงทุน':        { icon: 'TrendingUp',       color: '#5F9A7A' },
  'expense:ชำระหนี้':     { icon: 'CreditCard',       color: '#2C6488' },
  'expense:อื่นๆ':        { icon: 'Tag',              color: '#94a3b8' },
  // ── รายรับ (income) ──
  'income:เงินเดือน':     { icon: 'Briefcase',        color: '#10b981' },
  'income:รายได้พิเศษ':   { icon: 'Star',             color: '#f59e0b' },
  'income:โบนัส':         { icon: 'Gift',             color: '#6366f1' },
  'income:ค่าล่วงเวลา':   { icon: 'Zap',              color: '#f97316' },
  'income:การลงทุน':      { icon: 'DollarSign',       color: '#3b82f6' },
  'income:อื่นๆ':         { icon: 'Tag',              color: '#94a3b8' },
  // ── การโอน (transfer) ──
  'transfer:โอนผ่านธนาคาร': { icon: 'ArrowLeftRight', color: '#6366f1' },
  'transfer:ฝากและถอน':     { icon: 'PiggyBank',      color: '#10b981' },
  'transfer:การยืมเงิน':    { icon: 'Banknote',       color: '#f59e0b' },
  'transfer:การให้ยืมเงิน': { icon: 'Wallet',         color: '#3b82f6' },
  'transfer:การชำระคืน':    { icon: 'Landmark',       color: '#f97316' },
  'transfer:อื่นๆ':         { icon: 'Tag',            color: '#94a3b8' },
};

// hash ชื่อแบบง่าย (deterministic) → index ใน palette
function hashString(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0; // 32-bit
  }
  return Math.abs(h);
}

// คืนสไตล์ { icon, color } ของหมวดหมู่ — รับประกันว่ามีค่าคืนเสมอ
export function getCategoryStyle(cat) {
  if (!cat) return { icon: FALLBACK_ICON, color: FALLBACK_COLOR };

  const key = `${cat.type}:${cat.name}`;
  const preset = DEFAULT_CATEGORY_STYLES[key];
  // หมวดเริ่มต้น (ไม่มี user_id) ที่มีใน preset → ใช้ค่า preset
  if (!cat.user_id && preset) return preset;
  // ชื่อ "อื่นๆ" หรือชื่อที่ตรง preset อื่น ๆ ก็ยืมสไตล์มาใช้ได้
  if (preset) return preset;

  // หมวดที่ผู้ใช้สร้างเอง → ไอคอนเริ่มต้น + สีจาก hash ของชื่อ
  const color = CUSTOM_PALETTE[hashString(cat.name || cat.id || '') % CUSTOM_PALETTE.length];
  return { icon: FALLBACK_ICON, color };
}

export const getCategoryIcon  = (cat) => getCategoryStyle(cat).icon;
export const getCategoryColor = (cat) => getCategoryStyle(cat).color;
