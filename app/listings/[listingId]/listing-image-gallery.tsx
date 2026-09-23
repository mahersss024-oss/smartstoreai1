'use client';
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, X } from 'lucide-react';

type ListingImageGalleryProps = {
  images: string[];
  title: string;
};

export function ListingImageGallery({
  images,
  title,
}: ListingImageGalleryProps) {
  const visibleImages = images.slice(0, 8);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const selectedImage = visibleImages[selectedImageIndex] ?? visibleImages[0] ?? '';
  const shouldShowThumbnails = visibleImages.length > 1;
  const selectedImageLabel = `${selectedImageIndex + 1} / ${visibleImages.length}`;
  const showImageFallback = (image: HTMLImageElement) => {
    image.hidden = true;
    image.nextElementSibling?.removeAttribute('hidden');
  };
  const openLightbox = (index: number) => {
    setSelectedImageIndex(index);
    setIsLightboxOpen(true);
  };
  const showPreviousImage = useCallback(() => {
    setSelectedImageIndex((currentIndex) =>
      currentIndex === 0 ? visibleImages.length - 1 : currentIndex - 1,
    );
  }, [visibleImages.length]);
  const showNextImage = useCallback(() => {
    setSelectedImageIndex((currentIndex) =>
      currentIndex === visibleImages.length - 1 ? 0 : currentIndex + 1,
    );
  }, [visibleImages.length]);

  useEffect(() => {
    if (!isLightboxOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLightboxOpen(false);
      }
      if (event.key === 'ArrowLeft' && shouldShowThumbnails) {
        showPreviousImage();
      }
      if (event.key === 'ArrowRight' && shouldShowThumbnails) {
        showNextImage();
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isLightboxOpen, shouldShowThumbnails, showNextImage, showPreviousImage]);

  return (
    <section className="w-full max-w-2xl overflow-hidden rounded-md border bg-white shadow-sm dark:bg-card">
      <div className="grid gap-2">
        <button
          aria-label="فتح الصورة بالحجم الكامل"
          className="aspect-[16/9] w-full overflow-hidden bg-slate-100 text-left dark:bg-slate-950"
          onClick={() => openLightbox(selectedImageIndex)}
          type="button"
        >
          <img
            alt={title}
            className="h-full w-full object-contain"
            onError={(event) => showImageFallback(event.currentTarget)}
            src={selectedImage}
          />
          <div hidden className="grid h-full w-full place-items-center text-slate-500 dark:text-slate-400">
            <ImageIcon className="size-8" />
          </div>
        </button>
        {shouldShowThumbnails && (
          <div className="grid grid-cols-4 gap-1.5 px-2 pb-2 sm:px-3 sm:pb-3">
            {visibleImages.map((image, index) => {
              const isSelected = index === selectedImageIndex;

              return (
                <button
                  key={`${image}-${index}`}
                  aria-label={`فتح الصورة ${index + 1} بالحجم الكامل`}
                  aria-pressed={isSelected}
                  className={`aspect-square overflow-hidden rounded-md border bg-slate-100 transition ${
                    isSelected
                      ? 'border-blue-600 ring-2 ring-blue-600/30'
                      : 'hover:border-blue-400'
                  }`}
                  onClick={() => openLightbox(index)}
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
      {isLightboxOpen && selectedImage && (
        <div
          aria-label="عارض صور الإعلان"
          aria-modal="true"
          className="fixed inset-0 z-50 grid grid-rows-[auto_1fr_auto] bg-black text-white"
          role="dialog"
        >
          <div className="flex items-center justify-between px-4 py-5">
            <button
              aria-label="إغلاق عارض الصور"
              className="grid size-11 place-items-center rounded-full text-white transition hover:bg-white/10"
              onClick={() => setIsLightboxOpen(false)}
              type="button"
            >
              <X className="size-7" />
            </button>
          </div>
          <div className="grid min-h-0 place-items-center">
            <img
              alt={title}
              className="max-h-full max-w-full object-contain"
              onError={(event) => showImageFallback(event.currentTarget)}
              src={selectedImage}
            />
            <div hidden className="grid h-full w-full place-items-center text-slate-300">
              <ImageIcon className="size-10" />
            </div>
          </div>
          <div className="flex items-center justify-center gap-10 px-4 pb-8 pt-5">
            <button
              aria-label="الصورة السابقة"
              className="grid size-12 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-40"
              disabled={!shouldShowThumbnails}
              onClick={showPreviousImage}
              type="button"
            >
              <ChevronLeft className="size-8" />
            </button>
            <span className="min-w-16 text-center text-2xl font-medium tabular-nums">
              {selectedImageLabel}
            </span>
            <button
              aria-label="الصورة التالية"
              className="grid size-12 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-40"
              disabled={!shouldShowThumbnails}
              onClick={showNextImage}
              type="button"
            >
              <ChevronRight className="size-8" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
