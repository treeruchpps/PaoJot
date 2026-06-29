// จัดลำดับการแสดง "หมวดหมู่" ให้เหมือนหน้า Categories ทุกที่ในแอป
// - หมวดเริ่มต้น (ไม่มี user_id) เรียงตามลำดับที่กำหนดไว้ด้านล่าง
// - หมวดที่ผู้ใช้สร้างเองต่อท้าย, หมวด "อื่นๆ" อยู่ท้ายสุดเสมอ
// - ถ้าผู้ใช้เคยลากจัดลำดับเอง (เก็บใน localStorage) จะเคารพลำดับนั้นก่อน

// key ใน localStorage ที่เก็บลำดับหมวดที่ผู้ใช้ลากจัดเอง
export const CATEGORY_ORDER_KEY = 'pm_cat_order';

export const EXPENSE_CATEGORY_ORDER = [
  'อาหาร',
  'เดินทาง',
  'ของใช้',
  'ช้อปปิ้ง',
  'บันเทิง',
  'ที่อยู่อาศัย',
  'ชำระบิล',
  'สุขภาพ',
  'ครอบครัว',
  'สัตว์เลี้ยง',
  'ของขวัญ',
  'การบริจาค',
  'การศึกษา',
  'ท่องเที่ยว',
  'งาน',
  'ลงทุน',
  'ชำระหนี้',
  'อื่นๆ',
];
export const INCOME_CATEGORY_ORDER = [
  'เงินเดือน',
  'รายได้พิเศษ',
  'โบนัส',
  'ค่าล่วงเวลา',
  'การลงทุน',
  'อื่นๆ',
];
export const TRANSFER_CATEGORY_ORDER = [
  'โอนผ่านธนาคาร',
  'ฝากและถอน',
  'การยืมเงิน',
  'การให้ยืมเงิน',
  'การชำระคืน',
  'อื่นๆ',
];

const expenseOrderMap = Object.fromEntries(EXPENSE_CATEGORY_ORDER.map((name, index) => [name, index]));
const incomeOrderMap = Object.fromEntries(INCOME_CATEGORY_ORDER.map((name, index) => [name, index]));
const transferOrderMap = Object.fromEntries(TRANSFER_CATEGORY_ORDER.map((name, index) => [name, index]));

// หมวด "อื่นๆ" เริ่มต้นของระบบ (ไม่มี user_id) — ใช้ดันไปท้ายสุดเสมอ
export const isDefaultOtherCategory = (cat) => !cat?.user_id && cat?.name === 'อื่นๆ';

// เรียงหมวดตามลำดับมาตรฐานของแต่ละประเภท (expense/income/transfer)
export function sortCategoriesLikeCategoryPage(list = [], type = '') {
  const items = [...list];
  const orderMap = type === 'expense'
    ? expenseOrderMap
    : type === 'income'
      ? incomeOrderMap
      : type === 'transfer'
        ? transferOrderMap
        : {};

  return items.sort((a, b) => {
    const aOrder = !a.user_id && orderMap[a.name] !== undefined ? orderMap[a.name] : null;
    const bOrder = !b.user_id && orderMap[b.name] !== undefined ? orderMap[b.name] : null;
    const aBucket = isDefaultOtherCategory(a) ? 3 : aOrder !== null ? 0 : a.user_id ? 1 : 2;
    const bBucket = isDefaultOtherCategory(b) ? 3 : bOrder !== null ? 0 : b.user_id ? 1 : 2;
    if (aBucket !== bBucket) return aBucket - bBucket;
    if (aOrder !== null || bOrder !== null) return (aOrder ?? 50) - (bOrder ?? 50);
    return 0;
  });
}

// คืนรายการหมวดตามลำดับที่ผู้ใช้บันทึกไว้ (ถ้ามี) ไม่งั้น fallback เป็นลำดับมาตรฐาน
export function applySavedCategoryOrder(type, cats = []) {
  try {
    const orderMap = JSON.parse(localStorage.getItem(CATEGORY_ORDER_KEY) || '{}');
    const order = orderMap[type];
    if (!order || order.length === 0) return sortCategoriesLikeCategoryPage(cats, type);
    const lookup = Object.fromEntries(cats.map((c) => [c.id, c]));
    const ordered = order.filter((id) => lookup[id]).map((id) => lookup[id]);
    // หมวดที่ยังไม่เคยถูกจัดลำดับ (เพิ่งสร้างใหม่) เรียงด้วยลำดับเริ่มต้นแล้วต่อท้าย
    const remainder = sortCategoriesLikeCategoryPage(cats.filter((c) => !order.includes(c.id)), type);
    // เคารพลำดับที่ผู้ใช้ลากไว้ทั้งหมด (รวมหมวดเริ่มต้น) — ไม่ re-sort ทับ
    return [...ordered, ...remainder];
  } catch {
    return sortCategoriesLikeCategoryPage(cats, type);
  }
}
