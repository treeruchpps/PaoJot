// ตัวช่วยกรอง "บัญชี" — แยกบัญชีปกติออกจากบัญชีที่ระบบสร้างให้เป้าหมายการออม
// เพื่อไม่ให้บัญชีเป้าหมายไปโผล่ในตัวเลือกบันทึกรายรับ/รายจ่าย/โอน

// บัญชีนี้เป็นบัญชีของ "เป้าหมายการออม" หรือไม่ (ดูจาก kind หรือชื่อที่ขึ้นต้นด้วย "เป้าหมาย:")
export function isSavingsGoalAccount(account) {
  if (!account) return false;
  return account.kind === 'savings_goal' || String(account.name || '').startsWith('เป้าหมาย:');
}

// คืนเฉพาะบัญชีสินทรัพย์ที่ใช้ทำธุรกรรมได้จริง (ตัดบัญชีเป้าหมายการออมออก)
export function getTransactionAccounts(accounts = []) {
  return accounts.filter((account) => account.type === 'asset' && !isSavingsGoalAccount(account));
}
