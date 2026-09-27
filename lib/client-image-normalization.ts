const normalizedImageMimeType = "image/jpeg";
const normalizedImageQuality = 0.88;
const normalizedImageMaxDimension = 1800;
const displayImageQuality = 0.78;
const thumbnailImageQuality = 0.68;
const derivedImageMimeType = "image/webp";
const uploadSafeImageMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const imageFileNamePattern =
  /\.(avif|bmp|gif|heic|heif|jfif|jpe?g|png|svg|tiff?|webp)$/i;

function getNormalizedImageSize(
  width: number,
  height: number,
  maxDimension = normalizedImageMaxDimension
) {
  const largestSide = Math.max(width, height);

  if (largestSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / largestSide;

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isProbablyImageFile(
  blob: Blob,
  mediaType?: string,
  fileName?: string
) {
  const detectedMediaType = (mediaType || blob.type).toLowerCase();

  return (
    detectedMediaType.startsWith("image/") ||
    Boolean(fileName && imageFileNamePattern.test(fileName))
  );
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(blob);

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image attachment could not be decoded."));
    };
    image.src = url;
  });
}

async function loadDrawableImage(blob: Blob): Promise<CanvasImageSource> {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(blob);
    } catch {
      // Some mobile formats decode through HTMLImageElement even when ImageBitmap fails.
    }
  }

  return loadImageElement(blob);
}

export async function convertImageBlobToJpegDataUrl(
  blob: Blob,
  options: {
    maxDimension?: number;
    quality?: number;
  } = {}
) {
  const image = await loadDrawableImage(blob);
  const sourceWidth =
    "width" in image && typeof image.width === "number" ? image.width : 0;
  const sourceHeight =
    "height" in image && typeof image.height === "number" ? image.height : 0;

  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("Image attachment has invalid dimensions.");
  }

  const size = getNormalizedImageSize(
    sourceWidth,
    sourceHeight,
    options.maxDimension ?? normalizedImageMaxDimension
  );
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image attachment could not be prepared.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);

  if ("close" in image && typeof image.close === "function") {
    image.close();
  }

  const normalizedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blobResult) => {
        if (blobResult) {
          resolve(blobResult);
          return;
        }

        reject(new Error("Image attachment could not be converted."));
      },
      normalizedImageMimeType,
      options.quality ?? normalizedImageQuality
    );
  });

  return readBlobAsDataUrl(normalizedBlob);
}

export async function convertAttachmentBlobToDataUrl(
  blob: Blob,
  mediaType?: string,
  fileName?: string
) {
  if (isProbablyImageFile(blob, mediaType, fileName)) {
    return {
      mediaType: normalizedImageMimeType,
      url: await convertImageBlobToJpegDataUrl(blob),
    };
  }

  return {
    mediaType: mediaType || blob.type || "application/octet-stream",
    url: await readBlobAsDataUrl(blob),
  };
}

export async function createNormalizedImageFile(
  file: File,
  options: {
    maxDimension?: number;
    quality?: number;
    suffix?: string;
    mediaType?: "image/jpeg" | "image/webp";
  } = {}
) {
  if (!isProbablyImageFile(file, file.type, file.name)) {
    return file;
  }

  const mediaType = options.mediaType ?? normalizedImageMimeType;
  const image = await loadDrawableImage(file);
  const sourceWidth = "width" in image && typeof image.width === "number" ? image.width : 0;
  const sourceHeight = "height" in image && typeof image.height === "number" ? image.height : 0;
  const size = getNormalizedImageSize(sourceWidth, sourceHeight, options.maxDimension);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image attachment could not be prepared.");
  if (mediaType === normalizedImageMimeType) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  if ("close" in image && typeof image.close === "function") image.close();
  const outputBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image attachment could not be converted.")), mediaType, options.quality ?? normalizedImageQuality);
  });
  const normalizedName = file.name.replace(/\.[^.]+$/, "") || "image";
  const suffix = options.suffix ? `-${options.suffix}` : "";
  const extension = mediaType === derivedImageMimeType ? "webp" : "jpg";

  return new File([outputBlob], `${normalizedName}${suffix}.${extension}`, {
    type: mediaType,
    lastModified: Date.now(),
  });
}

export async function createUploadableImageFile(file: File) {
  try {
    return await createNormalizedImageFile(file);
  } catch (error) {
    if (uploadSafeImageMimeTypes.has(file.type.toLowerCase())) {
      return file;
    }

    throw error;
  }
}

export async function prepareUploadableImageFiles(
  files: File[],
  maxConcurrency = 2
) {
  return Promise.all(queueUploadableImagePreparation(files, maxConcurrency));
}

export function queueUploadableImagePreparation(
  files: File[],
  maxConcurrency = 2
) {
  const workerCount = Math.min(Math.max(1, maxConcurrency), files.length || 1);
  const workers = Array.from({ length: workerCount }, () =>
    Promise.resolve()
  );

  return files.map((file, index) => {
    const workerIndex = index % workerCount;
    const preparation = workers[workerIndex].then(() =>
      createUploadableImageFile(file)
    );
    workers[workerIndex] = preparation.then(
      () => undefined,
      () => undefined
    );
    return preparation;
  });
}

export type ListingImageUploadFiles = {
  original: File;
  display: File | null;
  thumbnail: File | null;
};

export async function createListingImageUploadFiles(
  file: File
): Promise<ListingImageUploadFiles> {
  if (!isProbablyImageFile(file, file.type, file.name)) {
    return {
      original: file,
      display: null,
      thumbnail: null,
    };
  }

  try {
    const [original, display, thumbnail] = await Promise.all([
      createNormalizedImageFile(file),
      createNormalizedImageFile(file, {
        maxDimension: 900,
        quality: displayImageQuality,
        suffix: "display",
        mediaType: derivedImageMimeType,
      }),
      createNormalizedImageFile(file, {
        maxDimension: 360,
        quality: thumbnailImageQuality,
        suffix: "thumbnail",
        mediaType: derivedImageMimeType,
      }),
    ]);

    return {
      original,
      display,
      thumbnail,
    };
  } catch (error) {
    if (uploadSafeImageMimeTypes.has(file.type.toLowerCase())) {
      return {
        original: file,
        display: null,
        thumbnail: null,
      };
    }

    throw error;
  }
}
