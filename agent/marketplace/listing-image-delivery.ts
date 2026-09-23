type ListingImageUrls = {
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
};

export function createListingImageDeliveryUrls(
  originalUrl: string,
): ListingImageUrls {
  return {
    originalUrl,
    displayUrl: originalUrl,
    thumbnailUrl: originalUrl,
  };
}

export function normalizeListingImageDeliveryUrls<T extends ListingImageUrls>(
  image: T,
): T {
  const urls = createListingImageDeliveryUrls(image.originalUrl);

  return {
    ...image,
    ...urls,
  };
}
