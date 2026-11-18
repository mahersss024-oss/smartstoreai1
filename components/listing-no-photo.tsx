export function ListingNoPhoto({ className }: { className?: string }) {
  return (
    <div role="img" aria-label="إعلان بدون صور — سوق حمد"
      className={`grid place-items-center bg-white ${className ?? ''}`}>
      <span aria-hidden="true" className="aspect-[846/214] w-[68%] max-w-[260px] bg-black opacity-20"
        style={{ mask: 'url(/hamad-market-wordmark.webp) center / contain no-repeat' }} />
    </div>
  );
}
