export function activePublishedFavoriteWhere(userId: string) {
  return {
    userId,
    listing: {
      status: 'published',
      seller: { deletedAt: null },
    },
  } as const;
}
