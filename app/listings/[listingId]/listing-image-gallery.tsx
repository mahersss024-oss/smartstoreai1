'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, TouchEvent, WheelEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ResilientImage } from '@/components/resilient-image';

type ListingImageGalleryProps = {
  images: ListingGalleryImage[];
  title: string;
};

export type ListingGalleryImage = {
  originalUrl: string;
  displayUrl: string;
  thumbnailUrl: string;
};

type ImagePan = {
  x: number;
  y: number;
};

const minImageZoom = 1;
const maxImageZoom = 4;
const imageZoomStep = 0.5;
const emptyImagePan: ImagePan = { x: 0, y: 0 };

function clampImageZoom(value: number) {
  return Math.min(maxImageZoom, Math.max(minImageZoom, Number(value.toFixed(2))));
}

function clampValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getBoundedImagePan(
  pan: ImagePan,
  zoom: number,
  viewport: HTMLDivElement | null,
) {
  if (zoom <= 1 || !viewport) {
    return emptyImagePan;
  }

  const maxX = (viewport.clientWidth * (zoom - 1)) / 2;
  const maxY = (viewport.clientHeight * (zoom - 1)) / 2;

  return {
    x: clampValue(pan.x, -maxX, maxX),
    y: clampValue(pan.y, -maxY, maxY),
  };
}

function getTouchDistance(touches: {
  length: number;
  0?: { clientX: number; clientY: number };
  1?: { clientX: number; clientY: number };
}) {
  if (touches.length < 2 || !touches[0] || !touches[1]) {
    return null;
  }

  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY,
  );
}

function getImageKey(image: ListingGalleryImage, index: number) {
  return `${image.originalUrl}-${image.displayUrl}-${image.thumbnailUrl}-${index}`;
}

export function ListingImageGallery({
  images,
  title,
}: ListingImageGalleryProps) {
  const visibleImages = images;
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [imageZoom, setImageZoom] = useState(1);
  const [imagePan, setImagePan] = useState<ImagePan>(emptyImagePan);
  const imageViewportRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchPanStartRef = useRef<{
    x: number;
    y: number;
    pan: ImagePan;
  } | null>(null);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(1);
  const pinchStartPanRef = useRef<ImagePan>(emptyImagePan);
  const mousePanStartRef = useRef<{
    x: number;
    y: number;
    pan: ImagePan;
  } | null>(null);
  const selectedImage = visibleImages[selectedImageIndex] ?? visibleImages[0] ?? '';
  const selectedDisplayUrl =
    typeof selectedImage === 'string' ? selectedImage : selectedImage?.displayUrl ?? '';
  const selectedOriginalUrl =
    typeof selectedImage === 'string'
      ? selectedImage
      : selectedImage?.originalUrl ?? selectedDisplayUrl;
  const selectedLightboxUrl =
    imageZoom > 1 ? selectedOriginalUrl : selectedDisplayUrl;
  const selectedThumbnailUrl =
    typeof selectedImage === 'string'
      ? selectedImage
      : selectedImage?.thumbnailUrl ?? selectedDisplayUrl;
  const shouldShowThumbnails = visibleImages.length > 1;
  const selectedImageLabel = `${selectedImageIndex + 1} / ${visibleImages.length}`;
  const openLightbox = (index: number) => {
    setSelectedImageIndex(index);
    setImageZoom(1);
    setImagePan(emptyImagePan);
    setIsLightboxOpen(true);
  };
  const selectLightboxImage = (index: number) => {
    setSelectedImageIndex(index);
    setImageZoom(1);
    setImagePan(emptyImagePan);
  };
  const updateImageZoom = (getNextZoom: (currentZoom: number) => number) => {
    setImageZoom((currentZoom) => {
      const nextZoom = clampImageZoom(getNextZoom(currentZoom));

      setImagePan((currentPan) =>
        getBoundedImagePan(currentPan, nextZoom, imageViewportRef.current),
      );

      return nextZoom;
    });
  };
  const zoomIn = () => {
    updateImageZoom((currentZoom) => currentZoom + imageZoomStep);
  };
  const zoomOut = () => {
    updateImageZoom((currentZoom) => currentZoom - imageZoomStep);
  };
  const resetZoom = () => {
    setImageZoom(1);
    setImagePan(emptyImagePan);
  };
  const showPreviousImage = useCallback(() => {
    setImageZoom(1);
    setImagePan(emptyImagePan);
    setSelectedImageIndex((currentIndex) =>
      currentIndex === 0 ? visibleImages.length - 1 : currentIndex - 1,
    );
  }, [visibleImages.length]);
  const showNextImage = useCallback(() => {
    setImageZoom(1);
    setImagePan(emptyImagePan);
    setSelectedImageIndex((currentIndex) =>
      currentIndex === visibleImages.length - 1 ? 0 : currentIndex + 1,
    );
  }, [visibleImages.length]);
  const handleLightboxTouchEnd = (x: number) => {
    pinchStartDistanceRef.current = null;
    touchPanStartRef.current = null;

    if (!shouldShowThumbnails || imageZoom > 1 || touchStartXRef.current === null) {
      touchStartXRef.current = null;
      return;
    }

    const swipeDistance = x - touchStartXRef.current;
    touchStartXRef.current = null;

    if (Math.abs(swipeDistance) < 45) {
      return;
    }

    if (swipeDistance > 0) {
      showPreviousImage();
      return;
    }

    showNextImage();
  };
  const handleLightboxTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touchDistance = getTouchDistance(event.touches);

    if (touchDistance !== null) {
      pinchStartDistanceRef.current = touchDistance;
      pinchStartZoomRef.current = imageZoom;
      pinchStartPanRef.current = imagePan;
      touchStartXRef.current = null;
      touchPanStartRef.current = null;
      return;
    }

    touchPanStartRef.current = {
      x: event.changedTouches[0]?.clientX ?? 0,
      y: event.changedTouches[0]?.clientY ?? 0,
      pan: imagePan,
    };
    touchStartXRef.current = event.changedTouches[0]?.clientX ?? null;
  };
  const handleLightboxTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const touchDistance = getTouchDistance(event.touches);

    if (touchDistance !== null && pinchStartDistanceRef.current !== null) {
      event.preventDefault();

      const nextZoom = clampImageZoom(
        pinchStartZoomRef.current * (touchDistance / pinchStartDistanceRef.current),
      );

      setImageZoom(nextZoom);
      setImagePan(
        getBoundedImagePan(pinchStartPanRef.current, nextZoom, imageViewportRef.current),
      );

      return;
    }

    if (imageZoom <= 1 || !touchPanStartRef.current || !event.touches[0]) {
      return;
    }

    event.preventDefault();
    setImagePan(
      getBoundedImagePan(
        {
          x:
            touchPanStartRef.current.pan.x +
            event.touches[0].clientX -
            touchPanStartRef.current.x,
          y:
            touchPanStartRef.current.pan.y +
            event.touches[0].clientY -
            touchPanStartRef.current.y,
        },
        imageZoom,
        imageViewportRef.current,
      ),
    );
  };
  const handleLightboxWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateImageZoom((currentZoom) =>
      currentZoom + (event.deltaY < 0 ? imageZoomStep : -imageZoomStep),
    );
  };
  const handleLightboxMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (imageZoom <= 1) {
      return;
    }

    mousePanStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      pan: imagePan,
    };
  };
  const handleLightboxMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (imageZoom <= 1 || !mousePanStartRef.current) {
      return;
    }

    setImagePan(
      getBoundedImagePan(
        {
          x: mousePanStartRef.current.pan.x + event.clientX - mousePanStartRef.current.x,
          y: mousePanStartRef.current.pan.y + event.clientY - mousePanStartRef.current.y,
        },
        imageZoom,
        imageViewportRef.current,
      ),
    );
  };
  const endMousePan = () => {
    mousePanStartRef.current = null;
  };

  useEffect(() => {
    if (!isLightboxOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsLightboxOpen(false);
      }
      if (event.key === 'ArrowRight' && shouldShowThumbnails) {
        showPreviousImage();
      }
      if (event.key === 'ArrowLeft' && shouldShowThumbnails) {
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

  useEffect(() => {
    if (!selectedDisplayUrl || visibleImages.length <= 1) {
      return;
    }

    const nextImage =
      visibleImages[
        selectedImageIndex === visibleImages.length - 1
          ? 0
          : selectedImageIndex + 1
      ];
    const nextDisplayUrl =
      typeof nextImage === 'string' ? nextImage : nextImage?.displayUrl;

    if (!nextDisplayUrl || nextDisplayUrl === selectedDisplayUrl) {
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    image.src = nextDisplayUrl;
  }, [selectedDisplayUrl, selectedImageIndex, visibleImages]);

  return (
    <section className="w-full overflow-hidden">
      <div className="grid gap-3">
        {visibleImages.length > 0 && (
          <div className="grid gap-3 px-1 py-2 sm:px-2">
            {visibleImages.map((image, index) => {
              const isSelected = index === selectedImageIndex;
              const displayUrl =
                typeof image === 'string' ? image : image.displayUrl;

              return (
                <button
                  key={
                    typeof image === 'string'
                      ? `${image}-${index}`
                      : getImageKey(image, index)
                  }
                  aria-label={`${title} - فتح الصورة ${index + 1} بالحجم الكامل`}
                  aria-pressed={isSelected}
                  className={`aspect-[4/3] w-full overflow-hidden bg-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${
                    isSelected ? 'opacity-100' : 'hover:opacity-95'
                  }`}
                  onClick={() => openLightbox(index)}
                  type="button"
                >
                  <ResilientImage
                    alt={`${title} - الصورة ${index + 1}`}
                    className="h-full w-full object-cover"
                    decoding="async"
                    fallback={<ImageIcon className="size-4 text-slate-500 dark:text-slate-400" />}
                    loading={index === 0 ? 'eager' : 'lazy'}
                    src={displayUrl}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>
      {isLightboxOpen && selectedLightboxUrl && createPortal(
        <div
          aria-label="عارض صور الإعلان"
          aria-modal="true"
          className="fixed inset-0 z-[2147483647] grid h-dvh w-screen grid-rows-[auto_1fr_auto] overscroll-contain bg-black text-white"
          role="dialog"
        >
          <div className="z-20 flex items-center justify-between px-4 py-4">
            <div className="flex items-center gap-2">
              <button
                aria-label="إغلاق عارض الصور"
                className="grid size-11 place-items-center rounded-full text-white transition hover:bg-white/10"
                onClick={() => setIsLightboxOpen(false)}
                type="button"
              >
                <X className="size-7" />
              </button>
              <button
                aria-label="تصغير الصورة"
                className="grid size-11 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-40"
                disabled={imageZoom <= minImageZoom}
                onClick={zoomOut}
                type="button"
              >
                <ZoomOut className="size-6" />
              </button>
              <button
                aria-label="تكبير الصورة"
                className="grid size-11 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-40"
                disabled={imageZoom >= maxImageZoom}
                onClick={zoomIn}
                type="button"
              >
                <ZoomIn className="size-6" />
              </button>
              <button
                aria-label="إعادة حجم الصورة"
                className="hidden size-11 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-40 sm:grid"
                disabled={imageZoom === 1}
                onClick={resetZoom}
                type="button"
              >
                <RotateCcw className="size-5" />
              </button>
            </div>
            <span className="rounded-full bg-black/35 px-3 py-1 text-sm font-semibold tabular-nums text-white/90">
              {Math.round(imageZoom * 100)}%
            </span>
          </div>
          <div
            ref={imageViewportRef}
            className={`relative grid min-h-0 touch-none place-items-center overflow-hidden px-3 py-3 sm:px-20 sm:py-4 ${
              imageZoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
            onMouseDown={handleLightboxMouseDown}
            onMouseLeave={endMousePan}
            onMouseMove={handleLightboxMouseMove}
            onMouseUp={endMousePan}
            onTouchEnd={(event) =>
              handleLightboxTouchEnd(event.changedTouches[0]?.clientX ?? 0)
            }
            onTouchMove={handleLightboxTouchMove}
            onTouchStart={handleLightboxTouchStart}
            onWheel={handleLightboxWheel}
          >
            <ResilientImage
              key={`backdrop-${selectedThumbnailUrl || selectedDisplayUrl}`}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
              decoding="async"
              src={selectedThumbnailUrl || selectedDisplayUrl}
            />
            <div className="absolute inset-0 bg-black/55" />
            <ResilientImage
              key={`lightbox-${selectedLightboxUrl}`}
              alt={title}
              className="relative z-10 h-full w-full max-w-6xl select-none object-contain will-change-transform sm:h-auto sm:max-h-[68dvh] sm:w-auto sm:max-w-[min(88vw,44rem)]"
              decoding="async"
              fallback={<ImageIcon className="relative z-10 size-10 text-slate-300" />}
              onDoubleClick={() => {
                if (imageZoom > 1) {
                  resetZoom();
                  return;
                }

                updateImageZoom(() => 2);
              }}
              src={selectedLightboxUrl}
              style={{
                transform: `translate3d(${imagePan.x}px, ${imagePan.y}px, 0) scale(${imageZoom})`,
              }}
            />
            {shouldShowThumbnails && (
              <>
                <button
                  aria-label="الصورة السابقة"
                  className="absolute right-3 top-1/2 z-20 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-white/15 sm:right-6 sm:size-14"
                  onClick={showPreviousImage}
                  type="button"
                >
                  <ChevronRight className="size-8" />
                </button>
                <button
                  aria-label="الصورة التالية"
                  className="absolute left-3 top-1/2 z-20 grid size-12 -translate-y-1/2 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition hover:bg-white/15 sm:left-6 sm:size-14"
                  onClick={showNextImage}
                  type="button"
                >
                  <ChevronLeft className="size-8" />
                </button>
              </>
            )}
          </div>
          <div className="z-20 flex flex-col items-center gap-3 px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3">
            {shouldShowThumbnails && (
              <div className="hidden max-w-[min(88vw,44rem)] grid-cols-8 gap-2 sm:grid">
                {visibleImages.map((image, index) => {
                  const isSelected = index === selectedImageIndex;
                  const thumbnailUrl =
                    typeof image === 'string' ? image : image.thumbnailUrl;

                  return (
                    <button
                      key={
                        typeof image === 'string'
                          ? `lightbox-${image}-${index}`
                          : `lightbox-${getImageKey(image, index)}`
                      }
                      aria-label={`عرض الصورة ${index + 1}`}
                      aria-pressed={isSelected}
                      className={`aspect-[4/3] overflow-hidden rounded-md border bg-black/40 transition ${
                        isSelected
                          ? 'border-white ring-2 ring-white/35'
                          : 'border-white/15 hover:border-white/60'
                      }`}
                      onClick={() => selectLightboxImage(index)}
                      type="button"
                    >
                      <ResilientImage
                        alt=""
                        className="h-full w-full object-cover"
                        decoding="async"
                        fallback={<ImageIcon className="m-auto size-4 text-slate-400" />}
                        loading="lazy"
                        src={thumbnailUrl}
                      />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex items-center justify-center gap-10">
              <button
                aria-label="الصورة السابقة"
                className="grid size-12 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-40 sm:hidden"
                disabled={!shouldShowThumbnails}
                onClick={showPreviousImage}
                type="button"
              >
                <ChevronRight className="size-8" />
              </button>
              <span className="min-w-16 text-center text-xl font-medium tabular-nums text-white/95">
                {selectedImageLabel}
              </span>
              <button
                aria-label="الصورة التالية"
                className="grid size-12 place-items-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-40 sm:hidden"
                disabled={!shouldShowThumbnails}
                onClick={showNextImage}
                type="button"
              >
                <ChevronLeft className="size-8" />
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
