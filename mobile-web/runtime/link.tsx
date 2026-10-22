'use client';

import {
  forwardRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useMobileRouter } from './router';

type MobileLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  href: string | URL;
  prefetch?: boolean;
  children?: ReactNode;
};

const Link = forwardRef<HTMLAnchorElement, MobileLinkProps>(function Link(
  { href, onClick, target, download, children, ...props },
  ref,
) {
  const { push } = useMobileRouter();
  const targetHref = href.toString();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === '_blank' ||
      download
    ) return;

    event.preventDefault();
    push(targetHref);
  };

  return (
    <a {...props} ref={ref} href={targetHref} target={target} download={download} onClick={handleClick}>
      {children}
    </a>
  );
});

export default Link;
