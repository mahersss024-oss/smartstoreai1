export type PaginationInput = {
  page?: number | string;
  limit?: number | string;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
};

export type NormalizedPagination = {
  page: number;
  limit: number;
  skip: number;
  take: number;
};

function toPositiveInteger(value: unknown) {
  const parsed =
    typeof value === 'string' || typeof value === 'number'
      ? Number(value)
      : Number.NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function normalizePagination(
  input: PaginationInput = {},
  {
    defaultLimit = 24,
    maxLimit = 80,
    maxPage = 1000,
  }: {
    defaultLimit?: number;
    maxLimit?: number;
    maxPage?: number;
  } = {},
): NormalizedPagination {
  const requestedPage = toPositiveInteger(input.page) ?? 1;
  const page = Math.min(requestedPage, maxPage);
  const requestedLimit = toPositiveInteger(input.limit) ?? defaultLimit;
  const limit = Math.min(requestedLimit, maxLimit);

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit + 1,
  };
}

export function createPaginationMeta({
  page,
  limit,
  hasMore,
}: {
  page: number;
  limit: number;
  hasMore: boolean;
}): PaginationMeta {
  return {
    page,
    limit,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
  };
}

export function toPaginatedResponse<T>(
  records: T[],
  pagination: NormalizedPagination,
) {
  const hasMore = records.length > pagination.limit;

  return {
    items: records.slice(0, pagination.limit),
    pagination: createPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      hasMore,
    }),
  };
}

export function parsePaginationFromRequest(
  request: Request,
  options?: Parameters<typeof normalizePagination>[1],
) {
  const url = new URL(request.url);

  return normalizePagination(
    {
      page: url.searchParams.get('page') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    },
    options,
  );
}
