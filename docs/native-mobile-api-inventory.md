# فهرس واجهات API الحالية لسوق حمد

تحديث التنفيذ: 23 أكتوبر 2026. يشمل إضافات التطبيق الأصلي في هذه الجلسة؛ لا يعني أن التحديثات نُشرت على سيرفر الإنتاج.

الاكتشاف من الكود المحلي: **63 مسارًا و91 معالج HTTP**. الأرقام بين قوسين أسطر تعريف المعالجات وقت التحديث.

راجع [وثيقة البنية](native-mobile-architecture.ar.md) و[تشغيل التطبيق](../mobile/README.md). الفهرس ليس مواصفة صلاحيات أو طلب/استجابة؛ لكل مسار حراسه وعقده، وبعض المسارات تبث أو تعيد redirect/HTML. التطبيق الأصلي يستخدم API البيانات والمصادقة الأصلية، ويعرض شاشاته داخل حزمته.

| المسار | الطرق وأسطرها | المصدر |
| --- | --- | --- |
| `/api/account/profile` | `PATCH (70)`، `DELETE (199)` | [التنفيذ](../app/api/account/profile/route.ts) |
| `/api/account/profile/picture` | `POST (73)`، `DELETE (254)` | [التنفيذ](../app/api/account/profile/picture/route.ts) |
| `/api/admin/audit-log` | `GET (34)` | [التنفيذ](../app/api/admin/audit-log/route.ts) |
| `/api/admin/commissions` | `GET (9)` | [التنفيذ](../app/api/admin/commissions/route.ts) |
| `/api/admin/commissions/{commissionId}` | `PATCH (36)`، `DELETE (96)` | [التنفيذ](../app/api/admin/commissions/[commissionId]/route.ts) |
| `/api/admin/listings` | `GET (71)` | [التنفيذ](../app/api/admin/listings/route.ts) |
| `/api/admin/listings/{listingId}` | `PATCH (141)`، `DELETE (354)` | [التنفيذ](../app/api/admin/listings/[listingId]/route.ts) |
| `/api/admin/maintenance` | `GET (161)`، `POST (171)` | [التنفيذ](../app/api/admin/maintenance/route.ts) |
| `/api/admin/moderation` | `GET (17)`، `PATCH (82)` | [التنفيذ](../app/api/admin/moderation/route.ts) |
| `/api/admin/moderation/listings/{listingId}` | `PATCH (45)` | [التنفيذ](../app/api/admin/moderation/listings/[listingId]/route.ts) |
| `/api/admin/moderation/reports/{reportId}` | `PATCH (39)`، `DELETE (101)`، `GET (158)` | [التنفيذ](../app/api/admin/moderation/reports/[reportId]/route.ts) |
| `/api/admin/moderation/user-reports/{reportId}` | `PATCH (23)`، `DELETE (64)`، `GET (117)` | [التنفيذ](../app/api/admin/moderation/user-reports/[reportId]/route.ts) |
| `/api/admin/overview` | `GET (9)` | [التنفيذ](../app/api/admin/overview/route.ts) |
| `/api/admin/site-message` | `GET (29)`، `PATCH (40)` | [التنفيذ](../app/api/admin/site-message/route.ts) |
| `/api/admin/users` | `GET (69)` | [التنفيذ](../app/api/admin/users/route.ts) |
| `/api/admin/users/{userId}` | `PATCH (130)`، `DELETE (329)` | [التنفيذ](../app/api/admin/users/[userId]/route.ts) |
| `/api/analytics/visit` | `POST (32)` | [التنفيذ](../app/api/analytics/visit/route.ts) |
| `/api/auth/apple/callback` | `GET (218)`، `POST (222)` | [التنفيذ](../app/api/auth/apple/callback/route.ts) |
| `/api/auth/apple/native` | `POST (20)` | [التنفيذ](../app/api/auth/apple/native/route.ts) |
| `/api/auth/apple/native/challenge` | `POST (11)` | [التنفيذ](../app/api/auth/apple/native/challenge/route.ts) |
| `/api/auth/apple/start` | `GET (12)` | [التنفيذ](../app/api/auth/apple/start/route.ts) |
| `/api/auth/commission-agreement` | `POST (15)` | [التنفيذ](../app/api/auth/commission-agreement/route.ts) |
| `/api/auth/google/callback` | `GET (97)` | [التنفيذ](../app/api/auth/google/callback/route.ts) |
| `/api/auth/google/native` | `POST (17)` | [التنفيذ](../app/api/auth/google/native/route.ts) |
| `/api/auth/google/native-config` | `GET (5)` | [التنفيذ](../app/api/auth/google/native-config/route.ts) |
| `/api/auth/google/start` | `GET (15)` | [التنفيذ](../app/api/auth/google/start/route.ts) |
| `/api/auth/logout` | `POST (5)` | [التنفيذ](../app/api/auth/logout/route.ts) |
| `/api/auth/mobile/callback` | `GET (12)` | [التنفيذ](../app/api/auth/mobile/callback/route.ts) |
| `/api/auth/mobile/exchange` | `GET (22)` | [التنفيذ](../app/api/auth/mobile/exchange/route.ts) |
| `/api/auth/mobile/open` | `GET (60)` | [التنفيذ](../app/api/auth/mobile/open/route.ts) |
| `/api/auth/session` | `GET (22)` | [التنفيذ](../app/api/auth/session/route.ts) |
| `/api/chat` | `POST (922)` | [التنفيذ](../app/api/chat/route.ts) |
| `/api/chat/reset` | `POST (6)` | [التنفيذ](../app/api/chat/reset/route.ts) |
| `/api/health` | `GET (64)` | [التنفيذ](../app/api/health/route.ts) |
| `/api/marketplace/commission-payment-methods` | `GET (4)` | [التنفيذ](../app/api/marketplace/commission-payment-methods/route.ts) |
| `/api/marketplace/commissions/{commissionId}` | `PATCH (21)` | [التنفيذ](../app/api/marketplace/commissions/[commissionId]/route.ts) |
| `/api/marketplace/conversations` | `POST (15)` | [التنفيذ](../app/api/marketplace/conversations/route.ts) |
| `/api/marketplace/conversations/{conversationId}` | `GET (64)`، `DELETE (97)`، `POST (126)` | [التنفيذ](../app/api/marketplace/conversations/[conversationId]/route.ts) |
| `/api/marketplace/listing-category` | `POST (7)` | [التنفيذ](../app/api/marketplace/listing-category/route.ts) |
| `/api/marketplace/listings` | `GET (55)`، `POST (104)` | [التنفيذ](../app/api/marketplace/listings/route.ts) |
| `/api/marketplace/listings/{listingId}` | `GET (61)`، `PATCH (91)` | [التنفيذ](../app/api/marketplace/listings/[listingId]/route.ts) |
| `/api/marketplace/listings/{listingId}/contact` | `GET (11)` | [التنفيذ](../app/api/marketplace/listings/[listingId]/contact/route.ts) |
| `/api/marketplace/listings/{listingId}/favorite` | `GET (15)`، `POST (53)` | [التنفيذ](../app/api/marketplace/listings/[listingId]/favorite/route.ts) |
| `/api/marketplace/listings/{listingId}/images` | `POST (43)` | [التنفيذ](../app/api/marketplace/listings/[listingId]/images/route.ts) |
| `/api/marketplace/listings/{listingId}/images/{imageId}` | `PATCH (26)`، `DELETE (107)` | [التنفيذ](../app/api/marketplace/listings/[listingId]/images/[imageId]/route.ts) |
| `/api/marketplace/listings/{listingId}/reports` | `GET (30)`، `POST (43)` | [التنفيذ](../app/api/marketplace/listings/[listingId]/reports/route.ts) |
| `/api/marketplace/listings/{listingId}/similar-follow` | `GET (15)`، `POST (46)` | [التنفيذ](../app/api/marketplace/listings/[listingId]/similar-follow/route.ts) |
| `/api/marketplace/me/commissions` | `GET (8)` | [التنفيذ](../app/api/marketplace/me/commissions/route.ts) |
| `/api/marketplace/me/conversations` | `GET (11)` | [التنفيذ](../app/api/marketplace/me/conversations/route.ts) |
| `/api/marketplace/me/favorites` | `GET (8)` | [التنفيذ](../app/api/marketplace/me/favorites/route.ts) |
| `/api/marketplace/me/follows` | `GET (5)` | [التنفيذ](../app/api/marketplace/me/follows/route.ts) |
| `/api/marketplace/me/listings` | `GET (8)` | [التنفيذ](../app/api/marketplace/me/listings/route.ts) |
| `/api/marketplace/me/listings/{listingId}` | `GET (10)` | [التنفيذ](../app/api/marketplace/me/listings/[listingId]/route.ts) |
| `/api/marketplace/users/{userId}/follow` | `GET (15)`، `POST (44)` | [التنفيذ](../app/api/marketplace/users/[userId]/follow/route.ts) |
| `/api/marketplace/users/{userId}/profile` | `GET (10)` | [التنفيذ](../app/api/marketplace/users/[userId]/profile/route.ts) |
| `/api/marketplace/users/{userId}/ratings` | `GET (22)`، `POST (51)` | [التنفيذ](../app/api/marketplace/users/[userId]/ratings/route.ts) |
| `/api/marketplace/users/{userId}/reports` | `POST (19)` | [التنفيذ](../app/api/marketplace/users/[userId]/reports/route.ts) |
| `/api/mobile/bootstrap` | `GET (24)` | [التنفيذ](../app/api/mobile/bootstrap/route.ts) |
| `/api/mobile/push/register` | `POST (28)`، `DELETE (87)` | [التنفيذ](../app/api/mobile/push/register/route.ts) |
| `/api/moderator/overview` | `GET (21)` | [التنفيذ](../app/api/moderator/overview/route.ts) |
| `/api/notifications` | `GET (10)`، `PATCH (31)`، `DELETE (52)` | [التنفيذ](../app/api/notifications/route.ts) |
| `/api/push/subscribe` | `GET (32)`، `POST (44)`، `DELETE (102)` | [التنفيذ](../app/api/push/subscribe/route.ts) |
| `/api/realtime/stream` | `GET (44)` | [التنفيذ](../app/api/realtime/stream/route.ts) |
