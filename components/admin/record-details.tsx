import { Fragment } from 'react';
import { formatMarketplaceCategory } from '@/lib/marketplace/categories';

const labels: Record<string, string> = {
  title: 'العنوان',
  description: 'الوصف',
  price: 'السعر',
  category: 'التصنيف',
  city: 'المدينة',
  status: 'الحالة',
  name: 'الاسم',
  email: 'البريد الإلكتروني',
  phoneNumber: 'رقم التواصل',
  reason: 'السبب',
  details: 'تفاصيل البلاغ',
  resolution: 'نتيجة المراجعة',
  createdAt: 'تاريخ الإنشاء',
  updatedAt: 'آخر تحديث',
  resolvedAt: 'تاريخ المعالجة',
  closedAt: 'تاريخ الإغلاق',
  retainUntil: 'الاحتفاظ حتى',
  legalHold: 'تعليق الإتلاف',
  days: 'الأيام',
  action: 'الإجراء',
  condition: 'حالة المنتج',
  priceMode: 'طريقة السعر',
  views: 'المشاهدات',
  messageCount: 'الرسائل',
  favoriteCount: 'مرات الحفظ',
  firstPublishedAt: 'أول نشر',
  commissionAmount: 'مبلغ العمولة',
  productValue: 'قيمة البيع',
  commissionRatePercent: 'نسبة العمولة',
  paidAt: 'تاريخ السداد',
  before: 'قبل الإجراء',
  after: 'بعد الإجراء',
  previous: 'السابق',
  next: 'الجديد',
  role: 'الصلاحية',
  message: 'الرسالة',
  isEnabled: 'مفعّلة',
  expiresAt: 'انتهاء الصلاحية',
  count: 'العدد',
  total: 'الإجمالي',
  scope: 'نطاق العملية',
  removed: 'السجلات المحذوفة',
  listing: 'الإعلان',
  report: 'البلاغ',
  participants: 'الأطراف',
  commissions: 'العمولات',
  phoneUpdatedAt: 'تحديث رقم التواصل',
  deletedAt: 'تاريخ تعطيل الحساب',
};
const values: Record<string, string> = {
  open: 'مفتوحة',
  closed: 'مغلقة',
  reviewed: 'تمت المراجعة',
  dismissed: 'مرفوض',
  published: 'منشور',
  pending: 'بانتظار المراجعة',
  draft: 'مسودة',
  paused: 'متوقف',
  rejected: 'مرفوض',
  sold: 'مباع',
  deleted: 'محذوف',
  used: 'مستعمل',
  new: 'جديد',
  like_new: 'شبه جديد',
  damaged: 'متضرر',
  other: 'أخرى',
  paid: 'مدفوعة',
  due: 'مستحقة',
  waived: 'معفاة',
  disputed: 'متنازع عليها',
  pending_amount: 'بانتظار تحديد المبلغ',
  user: 'عميل',
  admin: 'مدير',
  owner: 'مالك المنصة',
  moderator: 'مشرف',
  review: 'توثيق المراجعة',
  conversation_report: 'بلاغ محادثة',
  fraud: 'احتيال',
  spam: 'محتوى مزعج',
};

export function displayValue(value: unknown, field?: string): string {
  if (value == null || value === '') return 'غير مسجل';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'string') {
    if (
      (field?.endsWith('At') || field === 'retainUntil') &&
      /^\d{4}-\d{2}-\d{2}T/.test(value) &&
      !Number.isNaN(Date.parse(value))
    ) {
      return new Intl.DateTimeFormat('ar-SA', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Riyadh',
      }).format(new Date(value));
    }
    if (field === 'category') return formatMarketplaceCategory(value);
    if (
      field === 'reason' &&
      !['conversation_report', 'fraud', 'spam'].includes(value)
    )
      return value;
    return field &&
      [
        'status',
        'condition',
        'category',
        'role',
        'resolution',
        'reason',
      ].includes(field) &&
      Object.hasOwn(values, value)
      ? values[value]
      : value;
  }
  return String(value);
}

export function TechnicalDetails({
  value,
  title = 'التفاصيل التقنية',
}: {
  value: unknown;
  title?: string;
}) {
  return (
    <details className="admin-technical">
      <summary>{title}</summary>
      <pre dir="ltr">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function RecordDetails({
  value,
  empty = 'لا توجد بيانات إضافية.',
  depth = 0,
  field,
}: {
  value: unknown;
  empty?: string;
  depth?: number;
  field?: string;
}) {
  if (value == null)
    return (
      <p className="text-sm text-muted-foreground">
        {field ? 'غير مسجل' : empty}
      </p>
    );
  if (typeof value !== 'object')
    return (
      <span className="whitespace-pre-wrap break-words">
        {displayValue(value, field)}
      </span>
    );
  if (depth >= 4) return <TechnicalDetails value={value} />;
  if (Array.isArray(value))
    return value.length ? (
      <div className="grid min-w-0 gap-3">
        {value.map((item, index) => (
          <div key={index} className="min-w-0 border-s-2 ps-3">
            <RecordDetails value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    ) : (
      <p className="text-sm text-muted-foreground">{empty}</p>
    );
  const entries = Object.entries(value);
  const readable = entries.filter(([key]) => Object.hasOwn(labels, key));
  const technical = Object.fromEntries(
    entries.filter(([key]) => !Object.hasOwn(labels, key)),
  );
  return (
    <div className="grid min-w-0 gap-3">
      {readable.length > 0 && (
        <dl className="admin-data-list">
          {readable.map(([key, item]) => (
            <Fragment key={key}>
              <dt>{labels[key]}</dt>
              <dd>
                <RecordDetails value={item} depth={depth + 1} field={key} />
              </dd>
            </Fragment>
          ))}
        </dl>
      )}
      {Object.keys(technical).length > 0 && (
        <TechnicalDetails value={technical} />
      )}
      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

export function evidenceEventLabel(action: string) {
  const actions: Record<string, string> = {
    'notification.viewed': 'الاطلاع على إشعار البلاغ للجميع',
    'case.opened': 'فتح القضية',
    'case.viewed': 'عرض القضية',
    'asset.viewed': 'عرض صورة محفوظة',
    'asset.stored': 'حفظ صورة',
    'asset.failed': 'تعذّر حفظ صورة',
    evidence_retry: 'إعادة محاولة حفظ الصور',
    evidence_extend: 'تمديد مدة الاحتفاظ',
    evidence_hold: 'تعليق الإتلاف',
    evidence_release: 'رفع تعليق الإتلاف',
    evidence_dispose: 'طلب إتلاف الأدلة',
    'UserReport.update': 'تحديث بلاغ محادثة',
    'Report.update': 'تحديث بلاغ إعلان',
  };
  return Object.hasOwn(actions, action)
    ? actions[action]
    : 'إجراء مسجّل في القضية';
}
