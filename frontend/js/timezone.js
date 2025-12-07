export const APP_TIMEZONE = "Europe/London";

function ensureDate(value) {
  if (value instanceof Date) {
    return value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toLondonLocaleString(value, locale, options = {}) {
  const date = ensureDate(value);
  if (!date) return "";
  return date.toLocaleString(locale, { timeZone: APP_TIMEZONE, ...options });
}

export function toLondonDateString(value, locale, options = {}) {
  const date = ensureDate(value);
  if (!date) return "";
  return date.toLocaleDateString(locale, { timeZone: APP_TIMEZONE, ...options });
}

export function toLondonTimeString(value, locale, options = {}) {
  const date = ensureDate(value);
  if (!date) return "";
  return date.toLocaleTimeString(locale, { timeZone: APP_TIMEZONE, ...options });
}
