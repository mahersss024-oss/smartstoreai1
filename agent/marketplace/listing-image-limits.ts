export const defaultMaxListingImages = 8;
export const hardMaxListingImages = defaultMaxListingImages;

export function getMaxListingImagesPerListing() {
  const configuredValue = Number.parseInt(
    process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING ?? '',
    10,
  );

  if (!Number.isFinite(configuredValue) || configuredValue <= 0) {
    return defaultMaxListingImages;
  }

  return Math.min(configuredValue, hardMaxListingImages);
}

export function hasReachedListingImageLimit(images: { length: number }) {
  return images.length >= getMaxListingImagesPerListing();
}
