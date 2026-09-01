import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'سياسة الخصوصية | SmartStore AI',
  description:
    'توضيح كيف يتعامل SmartStore AI مع البيانات المحلية والمحادثات والإعدادات.',
};

const sections = [
  {
    title: 'البيانات التي نحفظها',
    items: [
      'سجل المحادثات الذي يظهر في جهازك فقط بحسب ما يسمح به المتصفح.',
      'إعدادات البلد والعملة واللغة على هذا المتصفح.',
      'البيانات التي ترسلها داخل الشات بهدف توليد الرد.',
    ],
  },
  {
    title: 'كيف نستخدم البيانات',
    items: [
      'تحسين جودة الردود وتخصيصها حسب البلد والعملة.',
      'الحفاظ على المحادثات السابقة حتى تعود إليها لاحقًا.',
      'تشغيل البحث أو المعالجة الخلفية عند الحاجة فقط.',
    ],
  },
  {
    title: 'ملاحظات مهمة',
    items: [
      'لا نعرض سجل المحادثات إلا داخل المتصفح أو الجهاز الذي استخدمته.',
      'قد تمر بعض الرسائل عبر مزودات الذكاء الاصطناعي أو البحث التي تم تفعيلها في الخلفية.',
      'يمكنك حذف المحادثة أو مسح السجل من داخل الواجهة في أي وقت.',
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            SmartStore AI
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            سياسة الخصوصية
          </h1>
        </div>
        <Link
          href="/"
          className="rounded-full border border-border/70 bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
        >
          العودة للرئيسية
        </Link>
      </div>

      <section className="grid gap-4 rounded-2xl border border-border/60 bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm leading-7 text-muted-foreground">
          نعامل الخصوصية ببساطة: ما يلزم لعمل الشات فقط، وما يبقى مفيدًا لك
          فقط داخل جهازك، وما تحتاجه الخدمة لرد أفضل يمر عبر المسار التقني
          المعتاد للتشغيل.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm"
          >
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <ul className="mt-4 grid gap-3 text-sm leading-7 text-muted-foreground">
              {section.items.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
