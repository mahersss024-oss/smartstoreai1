import type { Prisma } from '@prisma/client';

import { noStoreHeaders } from '@/lib/api/no-store';
import { getAuthSession, isAdminSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import {
  createPaginationMeta,
  parsePaginationFromRequest,
} from '@/lib/pagination';

export const dynamic = 'force-dynamic';

const userRoles = new Set(['user', 'moderator', 'admin']);

function mapUser(user: {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  phoneNumber: string | null;
  phoneUpdatedAt: Date | null;
  role: string;
  commissionAgreementVersion: string | null;
  commissionAgreementAccepted: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count: {
    listings: number;
    buyerConversations: number;
    sellerConversations: number;
    messages: number;
    favorites: number;
    reports: number;
    userReportsReceived: number;
    commissions: number;
    pushSubscriptions: number;
  };
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name ?? undefined,
    picture: user.picture ?? undefined,
    phoneNumber: user.phoneNumber ?? undefined,
    phoneUpdatedAt: user.phoneUpdatedAt?.toISOString() ?? undefined,
    role: user.role,
    commissionAgreementVersion: user.commissionAgreementVersion ?? undefined,
    commissionAgreementAccepted:
      user.commissionAgreementAccepted?.toISOString() ?? undefined,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    counts: {
      listings: user._count.listings,
      conversations:
        user._count.buyerConversations + user._count.sellerConversations,
      messages: user._count.messages,
      favorites: user._count.favorites,
      reports: user._count.reports,
      userReportsReceived: user._count.userReportsReceived,
      commissions: user._count.commissions,
      pushSubscriptions: user._count.pushSubscriptions,
    },
  };
}

export async function GET(request: Request) {
  const session = getAuthSession(request);

  if (!session) {
    return Response.json({ error: 'auth_required' }, { status: 401 });
  }

  if (!isAdminSession(session)) {
    return Response.json({ error: 'admin_required' }, { status: 403 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get('query')?.trim();
  const role = url.searchParams.get('role')?.trim();
  const pagination = parsePaginationFromRequest(request, {
    defaultLimit: 20,
    maxLimit: 50,
  });
  const where: Prisma.UserWhereInput = {
    ...(role && role !== 'all' && userRoles.has(role) ? { role } : {}),
    ...(query
      ? {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
            { phoneNumber: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        picture: true,
        phoneNumber: true,
        phoneUpdatedAt: true,
        role: true,
        commissionAgreementVersion: true,
        commissionAgreementAccepted: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            listings: true,
            buyerConversations: true,
            sellerConversations: true,
            messages: true,
            favorites: true,
            reports: true,
            userReportsReceived: true,
            commissions: true,
            pushSubscriptions: true,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.user.count({ where }),
  ]);
  const hasMore = users.length > pagination.limit;

  return Response.json(
    {
      users: users.slice(0, pagination.limit).map(mapUser),
      pagination: {
        ...createPaginationMeta({
          page: pagination.page,
          limit: pagination.limit,
          hasMore,
        }),
        total,
      },
    },
    { headers: noStoreHeaders },
  );
}
