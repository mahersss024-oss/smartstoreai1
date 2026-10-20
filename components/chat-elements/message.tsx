"use client";
/* eslint-disable @next/next/no-img-element */

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FileUIPart, UIMessage } from "ai";
import {
  ExternalLinkIcon,
  PaperclipIcon,
  XIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import type {
  ComponentProps,
  ComponentPropsWithoutRef,
  HTMLAttributes,
  ReactNode,
} from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user"
        ? "is-user ml-auto max-w-[80%] justify-end"
        : "is-assistant max-w-full",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex flex-col gap-2 overflow-hidden text-[1.03rem] leading-[1.85] sm:text-[1.06rem]",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-5 group-[.is-user]:py-4 group-[.is-user]:text-foreground",
      "group-[.is-user]:w-fit group-[.is-assistant]:w-full group-[.is-assistant]:max-w-full group-[.is-assistant]:text-foreground",
      className
    )}
    dir="auto"
    {...props}
  >
    {children}
  </div>
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

function getSmartStoreListingPath(href: unknown) {
  if (typeof href !== "string") {
    return null;
  }

  if (/^\/listings\/[^/?#]+/.test(href)) {
    return href;
  }

  try {
    const url = new URL(href);

    if (
      (url.hostname === "www.smartstore-ai.com" ||
        url.hostname === "smartstore-ai.com" ||
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1") &&
      /^\/listings\/[^/?#]+/.test(url.pathname)
    ) {
      return `${url.pathname}${url.search}${url.hash}`;
    }

    return null;
  } catch {
    return null;
  }
}

function SmartStoreListingLink({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) {
  const router = useRouter();

  return (
    <a
      className="mt-2 inline-flex h-9 w-fit items-center gap-2 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
      href={href}
      onClick={(event) => {
        event.preventDefault();
        router.push(href);
      }}
    >
      <ExternalLinkIcon className="size-4" />
      فتح الإعلان
      <span className="sr-only">{children}</span>
    </a>
  );
}

const messageMarkdownComponents = {
  p: ({ children, ...props }: ComponentPropsWithoutRef<'div'>) => (
    <div {...props}>{children}</div>
  ),
  a: ({ children, href, ...props }: ComponentPropsWithoutRef<'a'>) => {
    const listingPath = getSmartStoreListingPath(href);

    if (listingPath) {
      return (
        <SmartStoreListingLink href={listingPath}>
          {children}
        </SmartStoreListingLink>
      );
    }

    return (
      <a
        className="font-semibold text-blue-700 underline underline-offset-4 dark:text-blue-300"
        href={href}
        rel="noreferrer"
        target="_blank"
        {...props}
      >
        {children}
      </a>
    );
  },
};

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <div className="w-full text-start" dir="auto">
      <Streamdown
        className={cn(
          "size-full text-[1.03rem] leading-[1.85] sm:text-[1.06rem] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className
        )}
        components={messageMarkdownComponents}
        {...props}
      />
    </div>
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

MessageResponse.displayName = "MessageResponse";

export type MessageAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: FileUIPart;
  className?: string;
  onRemove?: () => void;
};

export function MessageAttachment({
  data,
  className,
  onRemove,
  ...props
}: MessageAttachmentProps) {
  const filename = data.filename || "";
  const mediaType =
    data.mediaType?.startsWith("image/") && data.url ? "image" : "file";
  const isImage = mediaType === "image";
  const attachmentLabel = filename || (isImage ? "صورة" : "مرفق");

  return (
    <div
      className={cn(
        "group relative size-24 overflow-hidden rounded-lg",
        className
      )}
      {...props}
    >
      {isImage ? (
        <>
          <img
            alt={filename || "مرفق"}
            className="size-full object-cover"
            height={100}
            src={data.url}
            width={100}
          />
          {onRemove && (
            <Button
              aria-label="إزالة المرفق"
              className="absolute top-2 right-2 size-6 rounded-full bg-background/80 p-0 opacity-0 backdrop-blur-sm transition-opacity hover:bg-background group-hover:opacity-100 [&>svg]:size-3"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              type="button"
              variant="ghost"
            >
              <XIcon />
              <span className="sr-only">إزالة</span>
            </Button>
          )}
        </>
      ) : (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex size-full shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <PaperclipIcon className="size-4" />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{attachmentLabel}</p>
            </TooltipContent>
          </Tooltip>
          {onRemove && (
            <Button
              aria-label="إزالة المرفق"
              className="size-6 shrink-0 rounded-full p-0 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100 [&>svg]:size-3"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              type="button"
              variant="ghost"
            >
              <XIcon />
              <span className="sr-only">إزالة</span>
            </Button>
          )}
        </>
      )}
    </div>
  );
}
