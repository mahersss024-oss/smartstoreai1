"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowDownIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { useCallback, useEffect } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";

export type ConversationProps = ComponentProps<typeof StickToBottom>;

export const Conversation = ({ className, ...props }: ConversationProps) => (
  <StickToBottom
    className={cn("relative flex-1 overflow-y-auto overscroll-contain [&>div]:overscroll-contain", className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
);

export type ConversationContentProps = ComponentProps<
  typeof StickToBottom.Content
>;

export const ConversationContent = ({
  className,
  ...props
}: ConversationContentProps) => (
  <StickToBottom.Content
    className={cn("flex flex-col gap-8 py-4", className)}
    style={{ 
      paddingLeft: 'var(--chat-padding)', 
      paddingRight: 'var(--chat-padding)',
      paddingBottom: 'var(--chat-bottom-spacing)'
    }}
    {...props}
  />
);

export type ConversationScrollButtonProps = ComponentProps<typeof Button>;

export const ConversationScrollButton = ({
  className,
  ...props
}: ConversationScrollButtonProps) => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();

  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  return (
    !isAtBottom && (
      <Button
        className={cn(
          "absolute bottom-4 left-[50%] translate-x-[-50%] rounded-full",
          className
        )}
        onClick={handleScrollToBottom}
        size="icon"
        type="button"
        variant="outline"
        {...props}
      >
        <ArrowDownIcon className="size-4" />
      </Button>
    )
  );
};

export type ConversationAutoScrollProps = {
  watchKey: unknown;
  enabled?: boolean;
};

export const ConversationAutoScroll = ({
  watchKey,
  enabled = true,
}: ConversationAutoScrollProps) => {
  const { scrollToBottom } = useStickToBottomContext();

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      void scrollToBottom();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [enabled, scrollToBottom, watchKey]);

  return null;
};
