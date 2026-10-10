import { createMobileAuthCallbackUrl } from '@/lib/auth/mobile-oauth';

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get('ticket');

  if (!ticket) {
    return new Response('Missing mobile sign-in ticket.', { status: 400 });
  }

  const callbackUrl = createMobileAuthCallbackUrl(ticket).toString();
  const callbackJson = JSON.stringify(callbackUrl);
  const callbackHtml = escapeHtml(callbackUrl);

  return new Response(
    `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>العودة إلى التطبيق</title>
  <meta name="robots" content="noindex">
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08111d;color:#eaf6ff;font-family:Arial,sans-serif}
    main{width:min(420px,calc(100% - 32px));text-align:center}
    a{display:inline-flex;margin-top:18px;border-radius:12px;background:#1d64f2;color:#fff;padding:12px 18px;text-decoration:none;font-weight:700}
    p{color:#b8c7d9;line-height:1.8}
  </style>
</head>
<body>
  <main>
    <h1>جاري العودة إلى التطبيق</h1>
    <p>إذا لم يفتح التطبيق تلقائيًا، اضغط زر العودة.</p>
    <a href="${callbackHtml}">العودة إلى التطبيق</a>
  </main>
  <script>
    try {
      history.replaceState(null, '', '/');
    } catch (_) {}
    location.replace(${callbackJson});
  </script>
</body>
</html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Referrer-Policy': 'no-referrer',
      },
    },
  );
}
