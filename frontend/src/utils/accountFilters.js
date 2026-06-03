export function isSavingsGoalAccount(account) {
  if (!account) return false;
  return account.kind === 'savings_goal' || String(account.name || '').startsWith('เป้าหมาย:');
}

export function getTransactionAccounts(accounts = []) {
  return accounts.filter((account) => account.type === 'asset' && !isSavingsGoalAccount(account));
}
