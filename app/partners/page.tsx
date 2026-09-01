import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'الشراكات | SmartStore AI',
  description: 'صفحة الشراكات لمزودي المنتجات غير الغذائية وروابط التسويق والبيانات.',
};

const requirements = [
  'اسم المنتج.',
  'السعر الحالي.',
  'الرابط المباشر للمنتج أو صفحة الهبوط.',
  'اسم المتجر أو الماركة.',
  'توفر المنتج أو حالته إن كانت مهمة.',
  'تصنيف واضح يساعد على استبعاد المواد الغذائية.',
];

const benefits = [
  'الظهور داخل تجربة الشات كمصدر بيانات موثوق.',
  'تحويل المستخدم إلى صفحة المنتج أو الرابط الربحي المناسب.',
  'إمكانية ربط أكثر من متجر أو مصدر في نفس التجربة.',
];

export default function PartnersPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-5 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            SmartStore AI
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            الشراكات
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
          SmartStore AI مصمم ليستقبل بيانات المنتجات غير الغذائية من أكثر من مصدر، ثم
          يعرضها داخل المحادثة ويحوّلها إلى تجربة شراء أو إحالة مناسبة حسب
          المصدر المتوفر.
        </p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">ما الذي نحتاجه من الشريك؟</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-7 text-muted-foreground">
            {requirements.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
          <h2 className="text-lg font-semibold">ما الذي يقدمه التكامل؟</h2>
          <ul className="mt-4 grid gap-3 text-sm leading-7 text-muted-foreground">
            {benefits.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-2xl border border-border/60 bg-muted/30 p-6 text-sm leading-7 text-muted-foreground shadow-sm sm:p-8">
        إذا كنت متجرًا أو مزود بيانات أو شبكة أفلييت للمنتجات غير الغذائية،
        فهذا المسار مناسب لربط بياناتك لاحقًا داخل الشات بشكل منظم، مع قابلية
        التوسع لمصادر متعددة دون تغيير تجربة المستخدم الأساسية.
      </section>
    </main>
  );
}
