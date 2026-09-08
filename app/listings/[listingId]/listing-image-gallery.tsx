'use client';
/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';

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

  return (
    <section className="w-full max-w-2xl overflow-hidden rounded-md border bg-white shadow-sm dark:bg-card">
      <div className="grid gap-2 p-2 sm:p-3 md:grid-cols-[minmax(0,1fr)_4.75rem]">
        <div className="aspect-[16/9] max-h-[18rem] overflow-hidden rounded-md bg-slate-100">
          <img
            alt={title}
            className="h-full w-full object-cover"
            src={selectedImage}
          />
        </div>
        <div className="grid grid-cols-5 gap-1.5 md:grid-cols-1">
          {visibleImages.map((image, index) => {
            const isSelected = image === selectedImage;

            return (
              <button
                key={`${image}-${index}`}
                aria-label={`عرض الصورة ${index + 1}`}
                aria-pressed={isSelected}
                className={`aspect-square overflow-hidden rounded-md border bg-slate-100 transition md:max-h-[4.5rem] ${
                  isSelected
                    ? 'border-blue-600 ring-2 ring-blue-600/30'
                    : 'hover:border-blue-400'
                }`}
                onClick={() => setSelectedImage(image)}
                type="button"
              >
                <img alt="" className="h-full w-full object-cover" src={image} />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
