export const defaultMaxListingImages = 8;

export function getMaxListingImagesPerListing() {
  const configuredValue = Number.parseInt(
    process.env.SMARTSTORE_MAX_IMAGES_PER_LISTING ?? '',
    10,
  );

  if (!Number.isFinite(configuredValue) || configuredValue <= 0) {
    return defaultMaxListingImages;
  }

  return configuredValue;
}

export function hasReachedListingImageLimit(images: { length: number }) {
  return images.length >= getMaxListingImagesPerListing();
}
