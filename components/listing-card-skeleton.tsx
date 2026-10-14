type ListingCardSkeletonProps = {
  count?: number;
};

export function ListingCardSkeleton({ count = 1 }: ListingCardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          aria-hidden="true"
          className="marketplace-listing-card marketplace-listing-card-skeleton grid min-h-[6.25rem] w-full min-w-0 grid-cols-[6.25rem_minmax(0,1fr)] overflow-hidden rounded-md border border-slate-200 bg-white/82 text-right shadow-sm dark:border-white/10 dark:bg-card/70 sm:min-h-[7.25rem] sm:grid-cols-[7.25rem_minmax(0,1fr)]"
          key={`listing-card-skeleton-${index}`}
          style={{ animationDelay: `${index * 70}ms` }}
        >
          <div className="relative aspect-square min-h-[6.25rem] bg-slate-100 dark:bg-slate-900 sm:min-h-[7.25rem]">
            <div className="marketplace-skeleton-shimmer h-full w-full" />
          </div>
          <div className="grid min-w-0 content-between gap-2 px-2 py-2 sm:px-3">
            <div className="grid gap-2">
              <div className="marketplace-skeleton-shimmer h-4 w-3/4 rounded-full" />
              <div className="marketplace-skeleton-shimmer h-3 w-1/2 rounded-full" />
            </div>
            <div className="marketplace-skeleton-shimmer h-5 w-1/3 rounded-full" />
            <div className="flex gap-2">
              <div className="marketplace-skeleton-shimmer h-3 w-20 rounded-full" />
              <div className="marketplace-skeleton-shimmer h-3 w-16 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
