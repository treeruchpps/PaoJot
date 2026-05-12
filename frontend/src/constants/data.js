export const NAV = [
  { id: 'analytics',    label: 'แดชบอร์ด',         icon: 'LayoutDashboard' },
  { id: 'accounts',     label: 'บัญชี', icon: 'Wallet' },
  { id: 'transactions', label: 'รายการธุรกรรม',       icon: 'ArrowLeftRight' },
  { id: 'budgets',      label: 'งบประมาณ',           icon: 'Target' },
  { id: 'goals',        label: 'เป้าหมายการออม',        icon: 'TrendingUp' },
  { id: 'recurring',    label: 'รายการทำซ้ำ',         icon: 'RefreshCw' },
  { id: 'categories',   label: 'หมวดหมู่',            icon: 'Tag' },
];

export const fmt = (n) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
