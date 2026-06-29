// ตัวช่วยจัดรูปแบบวันที่สำหรับแสดงผล (รูปแบบไทย วว/ดด/ปปปป)
// รองรับ input ทั้ง Date object และสตริง โดยเฉพาะ "YYYY-MM-DD" ที่ parse แบบ local
// เพื่อกันปัญหา timezone เลื่อนวัน

const pad2 = (value) => String(value).padStart(2, '0');

// แปลงค่าให้เป็น Date (คืน null ถ้าไม่ใช่วันที่ที่ถูกต้อง)
// "YYYY-MM-DD" จะ parse เป็นเวลา local ไม่ใช่ UTC เพื่อไม่ให้วันเลื่อน
const parseDateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const text = String(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
};

// วว/ดด/ปปปป (เช่น 05/01/2026)
export const formatDisplayDate = (value, fallback = '-') => {
  const date = parseDateValue(value);
  if (!date) return fallback;
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
};

// วว/ดด/ปปปป ชช:นน
export const formatDisplayDateTime = (value, fallback = '-') => {
  const date = parseDateValue(value);
  if (!date) return fallback;
  return `${formatDisplayDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

// ช่วงวันที่ "เริ่ม - สิ้นสุด" (ถ้าวันเดียวกันหรือมีค่าเดียวจะแสดงค่าเดียว)
export const formatDisplayDateRange = (from, to, fallback = '-') => {
  const start = formatDisplayDate(from, '');
  const end = formatDisplayDate(to, '');
  if (!start && !end) return fallback;
  if (!end || start === end) return start;
  if (!start) return end;
  return `${start} - ${end}`;
};
