const pad2 = (value) => String(value).padStart(2, '0');

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

export const formatDisplayDate = (value, fallback = '-') => {
  const date = parseDateValue(value);
  if (!date) return fallback;
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
};

export const formatDisplayDateTime = (value, fallback = '-') => {
  const date = parseDateValue(value);
  if (!date) return fallback;
  return `${formatDisplayDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
};

export const formatDisplayDateRange = (from, to, fallback = '-') => {
  const start = formatDisplayDate(from, '');
  const end = formatDisplayDate(to, '');
  if (!start && !end) return fallback;
  if (!end || start === end) return start;
  if (!start) return end;
  return `${start} - ${end}`;
};
