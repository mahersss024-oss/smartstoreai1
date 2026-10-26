export const publicLegalLinks = [
  { href: '/terms', label: 'شروط الاستخدام' },
  { href: '/privacy', label: 'سياسة الخصوصية' },
  { href: '/listing-policy', label: 'سياسة الإعلانات' },
  { href: '/commission-policy', label: 'سياسة رسوم المنصة' },
  { href: '/delete-account', label: 'حذف الحساب' },
] as const;

export function isPublicLegalPath(pathname: string): boolean {
  return publicLegalLinks.some(link => link.href === pathname);
}
