import sharp from 'sharp';

export const listingDisplayMaxDimension = 900;
export const listingThumbnailMaxDimension = 360;

export type GeneratedListingImageVariant = {
  data: Uint8Array;
  mediaType: 'image/webp';
  fileName: string;
  width: number;
  height: number;
};

export async function createListingImageVariants(input: {
  data: Uint8Array;
  mediaType: string;
  fileName?: string;
}) {
  const source = sharp(input.data, { animated: true, failOn: 'warning' });
  const metadata = await source.metadata();

  // Keep animated images untouched. Flattening them into one frame is a regression.
  if (input.mediaType === 'image/gif' && (metadata.pages ?? 1) > 1) {
    return null;
  }

  const baseName = (input.fileName?.replace(/\.[^.]+$/, '') || 'listing-image')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 80);

  async function createVariant(
    maxDimension: number,
    quality: number,
    suffix: 'display' | 'thumbnail',
  ): Promise<GeneratedListingImageVariant> {
    const { data, info } = await sharp(input.data, { failOn: 'warning' })
      .rotate()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality, smartSubsample: true })
      .toBuffer({ resolveWithObject: true });

    return {
      data: new Uint8Array(data),
      mediaType: 'image/webp',
      fileName: `${baseName}-${suffix}.webp`,
      width: info.width,
      height: info.height,
    };
  }

  const [display, thumbnail] = await Promise.all([
    createVariant(listingDisplayMaxDimension, 78, 'display'),
    createVariant(listingThumbnailMaxDimension, 68, 'thumbnail'),
  ]);

  return { display, thumbnail };
}
