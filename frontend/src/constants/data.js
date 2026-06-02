export const NAV = [
  { id: 'analytics',    label: 'แดชบอร์ด',         icon: 'LayoutDashboard' },
  { id: 'assistant',    label: 'แชท',                 icon: 'MessageCircle' },
  { id: 'accounts',     label: 'บัญชี', icon: 'Wallet' },
  { id: 'transactions', label: 'รายการธุรกรรม',       icon: 'ArrowLeftRight' },
  { id: 'budgets',      label: 'งบประมาณ',           icon: 'ChartPie' },
  { id: 'goals',        label: 'เป้าหมายการออม',        icon: 'PiggyBank' },
  { id: 'recurring',    label: 'รายการประจำ',         icon: 'RefreshCw' },
  { id: 'categories',   label: 'หมวดหมู่',            icon: 'Tag' },
];

export const fmt = (n) => new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
