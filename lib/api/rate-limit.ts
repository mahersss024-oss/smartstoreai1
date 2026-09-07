import { checkRateLimit } from '@/lib/rate-limit';

function getClientId(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const firstForwardedIp = forwardedFor?.split(',')[0]?.trim();

  return (
    firstForwardedIp ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    'anonymous'
  );
}

export async function enforceApiRateLimit(
  request: Request,
  input: {
    namespace: string;
    maxRequests?: number;
    windowMs?: number;
    actorId?: string;
  },
) {
  const retryAfterSeconds = await checkRateLimit({
    namespace: input.namespace,
    clientId: input.actorId ? `user:${input.actorId}` : getClientId(request),
    maxRequests: input.maxRequests,
    windowMs: input.windowMs,
  });

  if (retryAfterSeconds === null) {
    return null;
  }

  return Response.json(
    {
      error: 'rate_limited',
      message: 'Too many requests. Please try again shortly.',
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfterSeconds),
      },
    },
  );
}
