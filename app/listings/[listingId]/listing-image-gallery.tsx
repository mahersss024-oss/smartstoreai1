'use client';
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { ImageIcon } from 'lucide-react';

type ListingImageGalleryProps = {
  images: string[];
  title: string;
};

export function ListingImageGallery({
  images,
  title,
}: ListingImageGalleryProps) {
  const [selectedImage, setSelectedImage] = useState(images[0] ?? '');
  const visibleImages = images.slice(0, 8);
  const shouldShowThumbnails = visibleImages.length > 1;
  const showImageFallback = (image: HTMLImageElement) => {
    image.hidden = true;
    image.nextElementSibling?.removeAttribute('hidden');
  };

  return (
    <section className="w-full max-w-2xl overflow-hidden rounded-md border bg-white shadow-sm dark:bg-card">
      <div className="grid gap-2">
        <div className="aspect-[16/9] w-full overflow-hidden bg-slate-100 dark:bg-slate-950">
          <img
            alt={title}
            className="h-full w-full object-contain"
            onError={(event) => showImageFallback(event.currentTarget)}
            src={selectedImage}
          />
          <div hidden className="grid h-full w-full place-items-center text-slate-500 dark:text-slate-400">
            <ImageIcon className="size-8" />
          </div>
        </div>
        {shouldShowThumbnails && (
        <div className="grid grid-cols-4 gap-1.5 px-2 pb-2 sm:px-3 sm:pb-3">
          {visibleImages.map((image, index) => {
            const isSelected = image === selectedImage;

            return (
              <button
                key={`${image}-${index}`}
                aria-label={`عرض الصورة ${index + 1}`}
                aria-pressed={isSelected}
                className={`aspect-square overflow-hidden rounded-md border bg-slate-100 transition ${
                  isSelected
                    ? 'border-blue-600 ring-2 ring-blue-600/30'
                    : 'hover:border-blue-400'
                }`}
                onClick={() => setSelectedImage(image)}
                type="button"
              >
                <img
                  alt=""
                  className="h-full w-full object-contain"
                  onError={(event) => showImageFallback(event.currentTarget)}
                  src={image}
                />
                <span hidden className="grid h-full w-full place-items-center text-slate-500 dark:text-slate-400">
                  <ImageIcon className="size-4" />
                </span>
              </button>
            );
          })}
        </div>
        )}
      </div>
    </section>
  );
}
