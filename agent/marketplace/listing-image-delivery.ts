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

export function getListingThumbnailUrl(image?: Partial<ListingImageUrls> | null) {
  return image?.thumbnailUrl || image?.displayUrl || image?.originalUrl || null;
}

export function getListingDisplayUrl(image?: Partial<ListingImageUrls> | null) {
  return image?.displayUrl || image?.originalUrl || image?.thumbnailUrl || null;
}

export function getListingFullUrl(image?: Partial<ListingImageUrls> | null) {
  return image?.originalUrl || image?.displayUrl || image?.thumbnailUrl || null;
}
