const cloudinaryUploadPath = '/image/upload/';

const listingImageTransformations = {
  display: 'c_limit,w_1600,h_1600,q_auto:best,f_auto',
  thumbnail: 'c_limit,w_640,h_640,q_auto:best,f_auto',
} as const;

type ListingImageUrls = {
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
};

function createCloudinaryVariant(
  originalUrl: string,
  transformation: string,
) {
  let url: URL;

  try {
    url = new URL(originalUrl);
  } catch {
    return originalUrl;
  }

  if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') {
    return originalUrl;
  }

  const uploadPathIndex = url.pathname.indexOf(cloudinaryUploadPath);

  if (uploadPathIndex === -1) {
    return originalUrl;
  }

  const assetPathStart = uploadPathIndex + cloudinaryUploadPath.length;
  const assetPath = url.pathname.slice(assetPathStart);

  if (!assetPath) {
    return originalUrl;
  }

  if (assetPath.startsWith(`${transformation}/`)) {
    return originalUrl;
  }

  url.pathname = `${url.pathname.slice(
    0,
    assetPathStart,
  )}${transformation}/${assetPath}`;

  return url.toString();
}

export function createListingImageDeliveryUrls(
  originalUrl: string,
): ListingImageUrls {
  return {
    originalUrl,
    displayUrl: createCloudinaryVariant(
      originalUrl,
      listingImageTransformations.display,
    ),
    thumbnailUrl: createCloudinaryVariant(
      originalUrl,
      listingImageTransformations.thumbnail,
    ),
  };
}

export function normalizeListingImageDeliveryUrls<T extends ListingImageUrls>(
  image: T,
): T {
  const urls = createListingImageDeliveryUrls(image.originalUrl);

  if (
    urls.displayUrl === image.originalUrl &&
    urls.thumbnailUrl === image.originalUrl
  ) {
    return image;
  }

  return {
    ...image,
    ...urls,
  };
}
