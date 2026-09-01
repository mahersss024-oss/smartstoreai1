# SmartStore Product Data API Foundation

هذه الوثيقة هي الأساس التقني المعتمد لفكرة فصل جلب بيانات المنتجات عن مشروع الشات.

## الفكرة الأساسية

مشروع SmartStore AI الحالي يبقى مسؤولاً عن:

- واجهة الشات.
- فهم طلب العميل.
- حارس النطاق للتأكد أن الطلب داخل التجارة الإلكترونية فقط.
- استدعاء مساعد الذكاء الاصطناعي.
- عرض النتيجة للعميل.

أما جلب المنتجات والأسعار والروابط فيكون داخل مشروع مستقل لاحقاً باسم مقترح:

`SmartStore Product Data API`

هذا المشروع المستقل يتصل بالمتاجر أو شبكات الأفلييت أو ملفات المنتجات، ثم يرجع بيانات منظمة لمشروع الشات.

## التدفق المعتمد

```text
Client
  -> SmartStore AI Chat
  -> Input Scope Guard
  -> SmartStore Product Data API
  -> Shopping Assistant
  -> Output Scope Guard
  -> Client
```

## سبب الفصل

- حماية مفاتيح المتاجر والأفلييت بعيداً عن المتصفح.
- تطوير مصادر المنتجات بدون تغيير واجهة الشات.
- إمكانية ربط أكثر من تطبيق بنفس خدمة المنتجات.
- سهولة إضافة متاجر جديدة أو حذفها.
- تقليل التعقيد داخل مشروع الشات.
- منع النموذج من اختراع أسعار أو روابط؛ السعر والرابط يجب أن يأتيا من API حقيقي.

## متغيرات البيئة المستقبلية

عند بناء مشروع المنتجات وربطه بالشات، يستخدم مشروع الشات هذه المتغيرات من السيرفر فقط:

```env
SMARTSTORE_PRODUCTS_API_URL=https://api.smartstore-ai.com
SMARTSTORE_PRODUCTS_API_KEY=your-private-products-api-key
```

لا يتم إرسال `SMARTSTORE_PRODUCTS_API_KEY` إلى المتصفح أبداً.

## عقد البحث عن المنتجات

مشروع الشات يحتوي حالياً على عقد مبدئي في:

`agent/products/provider-contract.ts`

المطلوب من مشروع المنتجات المستقل أن يرجع بيانات قريبة من هذا الشكل:

```json
{
  "results": [
    {
      "id": "provider-product-id",
      "provider": "smartstore-products-api",
      "merchantName": "Noon",
      "productName": "Samsung Galaxy A35",
      "price": {
        "amount": 1199,
        "currency": "SAR",
        "display": "1199 SAR"
      },
      "productUrl": "https://merchant.example/product",
      "affiliateUrl": "https://tracking.example/product",
      "imageUrl": "https://cdn.example/image.jpg",
      "availability": "in_stock",
      "updatedAt": "2026-09-01T00:00:00.000Z",
      "metadata": {
        "brand": "Samsung",
        "storage": "128GB"
      }
    }
  ]
}
```

## Endpoints مقترحة للمشروع الثاني

```http
POST /v1/products/search
```

الاستخدام:

```json
{
  "query": "جوال سامسونج",
  "region": {
    "country": "SA",
    "city": "Riyadh",
    "currency": "SAR",
    "language": "ar"
  },
  "limit": 10
}
```

الاستجابة:

```json
{
  "results": [],
  "sourceStatus": {
    "searchedProviders": ["noon", "amazon-sa"],
    "failedProviders": [],
    "generatedAt": "2026-09-01T00:00:00.000Z"
  }
}
```

## قواعد مهمة

- لا يعتمد السعر أو رابط المنتج على نموذج الذكاء الاصطناعي.
- النموذج يستخدم نتائج API فقط للشرح والترتيب والمقارنة.
- إذا لم يجد API المنتج، يقول المساعد: المنتج غير موجود في المتاجر المتصلة حالياً.
- لا يقول المساعد إن المنتج غير موجود في السوق بالكامل.
- لا يتم استخدام البحث بالإنترنت لاستخراج أسعار أو روابط شراء مباشرة.
- يمكن استخدام البحث بالإنترنت للمعلومات العامة عن الشركات أو APIs أو التوثيق فقط.
- أي مصدر منتجات جديد يجب أن يلتزم بنفس شكل البيانات حتى لا يتغير مشروع الشات.

## نموذج الربط المستقبلي داخل الشات

تم تجهيز Provider داخل مشروع الشات يقرأ:

- `SMARTSTORE_PRODUCTS_API_URL`
- `SMARTSTORE_PRODUCTS_API_KEY`

ثم يرسل الطلب إلى مشروع المنتجات من الخادم فقط.

الملفات الجاهزة للربط:

- `agent/products/provider-contract.ts`
- `agent/products/smartstore-products-api.ts`
- `agent/products/registry.ts`
- `agent/tools/product-search.ts`

المساعد الرئيسي يستقبل النتائج كنص/سياق موثوق، مع تعليمات واضحة:

```text
Use only these product results for prices, availability, images, and links.
Do not invent product data.
If results are empty, say that no matching products were found in connected stores.
```

## حالة المشروع الحالية

- مشروع الشات جاهز معمارياً لهذا الربط.
- أداة `searchProducts` موجودة وجاهزة للمساعد.
- إذا لم يتم ضبط متغيرات API، ترجع الأداة حالة `unconfigured` ولا تسمح بتخمين الأسعار أو الروابط.
- حارس النطاق موجود ويعمل قبل المساعد.
- البحث بالإنترنت موجود لكنه ليس بديلاً عن Product API.
- جلب المنتجات المباشر يبدأ فقط بعد نشر مشروع Product Data API وضبط متغيرات البيئة.
