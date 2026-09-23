type ListingImageUrls = {
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
};

export function createListingImageDeliveryUrls(
  originalUrl: string,
  variants: {
    displayUrl?: string | null;
    thumbnailUrl?: string | null;
  } = {},
): ListingImageUrls {
  return {
    originalUrl,
    displayUrl: variants.displayUrl || originalUrl,
    thumbnailUrl: variants.thumbnailUrl || variants.displayUrl || originalUrl,
  };
}

export function normalizeListingImageDeliveryUrls<T extends ListingImageUrls>(
  image: T,
): T {
  const urls = createListingImageDeliveryUrls(image.originalUrl, {
    displayUrl: image.displayUrl,
    thumbnailUrl: image.thumbnailUrl,
  });

  return {
    ...image,
    ...urls,
  };
}
