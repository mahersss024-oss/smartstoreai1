/** A bounded operator guide; it never contains credentials or accepts executable input. */
export function getRecoveryEmergencyPlan(env: Record<string, string | undefined> = process.env) {
  const source = env.SMARTSTORE_RECOVERY_SOURCE_DB_IDENTIFIER?.trim() || 'smartstore-db';
  const region = env.SMARTSTORE_RECOVERY_AWS_REGION?.trim() || 'eu-central-1';
  return {
    format: 'souqhamad-recovery-plan-v1',
    generatedAt: new Date().toISOString(),
    region: /^[a-z]{2}-[a-z]+-\d$/.test(region) ? region : 'eu-central-1',
    sourceDatabase: /^[a-z][a-z0-9-]{0,62}$/.test(source) ? source : 'smartstore-db',
    applicationService: 'smartstore-ai',
    steps: [
      'سجّل وقت الحادث بتوقيت الرياض وUTC وحدّد سبب الحذف قبل أي استعادة.',
      'أوقف الكتابات ومهام التنظيف والرفع والإشعارات عبر إجراءات التشغيل المعتمدة، وتحقق من توقفها فعليًا؛ رسالة الموقع وحدها لا توقفها.',
      'إذا تعذّر دخول لوحة المالك، استخدم حساب AWS المخوّل مباشرة؛ لا تضف مسار دخول يتجاوز المصادقة.',
      'من RDS Automated backups اختر Restore to point in time بوقت قبل الحادث وداخل نافذة الاستعادة المتاحة، إلى مثيل خاص جديد.',
      'احتفظ بقاعدة الإنتاج كما هي للمراجعة ومصالحة الكتابات اللاحقة. لا تحذفها أو تستبدل endpoint قبل الفحص.',
      'افحص هوية المثيل المستعاد وTLS والترحيلات وبصماتها والمخطط والعلاقات والأعداد، دون تشغيل workers أو إرسال إشعارات منه.',
      'استعد ملفات النسخة الاحتياطية إلى عزل خاص، وتحقق من SHA256 لكل ملف واكتمال manifest؛ RDS وحده لا يستعيد ملفات R2.',
      'راجع الحذف والإتلاف المشروع والحسابات المعطلة بعد نقطة الاستعادة من مصدر مستقل. غياب سجل موثوق يمنع التحويل التلقائي.',
      'طابق صور القاعدة المستعادة مع الملفات المسموح بإعادتها فقط، وعالج الكتابات السليمة بعد نقطة الاستعادة ومهام التنظيف والإشعارات القديمة قبل التشغيل.',
      'بعد الاعتماد، حدّث سر DATABASE_URL إلى الهدف الموثق، مع إبقاء AUTH_SECRET الصحيح، وأعد نشر App Runner ثم اختبر health ومسار العميل.',
      'سجّل ما لم يُسترجع ووقت آخر بيانات مؤكدة ومدة التعافي، ثم أعد فتح الكتابات تدريجيًا وراقب الصور والإشعارات والأخطاء.',
    ],
    automaticProductionCutover: false,
    cloudResourcesMayHaveCost: true,
    checks: { databaseRestoreIsNotMediaRestore: true, snapshotAvailableIsNotFullVerification: true,
      tombstoneReconciliationRequired: true, existingLocalSyntheticDrillIsNotRdsRestoreProof: true },
    references: [
      'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PIT.html',
      'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_RestoreFromSnapshot.html',
    ],
  };
}
