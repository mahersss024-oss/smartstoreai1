const arabicDigitMap: Record<string, string> = {
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
};

export type ContactPhoneValidationResult =
  | { ok: true; phoneNumber: string | null }
  | { ok: false; message: string };

function normalizeDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => arabicDigitMap[digit] ?? digit);
}

export function countContactPhoneCandidates(value: string) {
  const normalized = normalizeDigits(value);

  return Array.from(
    normalized.matchAll(/(?:\+?\s*966|00966|0)?\s*5(?:[\s().-]*\d){8}/g),
  ).length;
}

export function normalizeContactPhoneNumber(
  value: unknown,
): ContactPhoneValidationResult {
  if (typeof value !== 'string') {
    return {
      ok: false,
      message: 'رقم الجوال غير صالح.',
    };
  }

  const trimmed = normalizeDigits(value).trim();

  if (!trimmed) {
    return { ok: true, phoneNumber: null };
  }

  if (countContactPhoneCandidates(trimmed) > 1) {
    return {
      ok: false,
      message: 'يمكن حفظ رقم تواصل رسمي واحد فقط.',
    };
  }

  const compact = trimmed.replace(/[\s().-]/g, '');
  const normalized = compact.startsWith('00')
    ? `+${compact.slice(2)}`
    : compact.startsWith('+')
      ? compact
      : compact.startsWith('966')
        ? `+${compact}`
        : compact.startsWith('05')
          ? `+966${compact.slice(1)}`
          : compact.startsWith('5')
            ? `+966${compact}`
            : compact;

  if (!/^\+9665\d{8}$/.test(normalized)) {
    return {
      ok: false,
      message: 'أدخل رقم جوال سعودي صحيح مثل 05xxxxxxxx أو +9665xxxxxxxx.',
    };
  }

  return { ok: true, phoneNumber: normalized };
}
