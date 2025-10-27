import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type ScrollElement = HTMLElement | null;

export type VirtualizerOptions = {
  count: number;
  getScrollElement: () => ScrollElement;
  estimateSize: () => number;
  overscan?: number;
};

export type VirtualItem = {
  key: number;
  index: number;
  start: number;
  end: number;
  size: number;
};

export type Virtualizer = {
  getVirtualItems: () => VirtualItem[];
  getTotalSize: () => number;
  scrollToIndex: (index: number) => void;
};

export function useVirtualizer({
  count,
  getScrollElement,
  estimateSize,
  overscan = 6,
}: VirtualizerOptions): Virtualizer {
  const scrollElementRef = useRef<ScrollElement>(null);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const element = getScrollElement();
    scrollElementRef.current = element;
    if (!element) return undefined;

    const handleScroll = () => {
      setScrollOffset(element.scrollTop);
    };

    const handleResize = () => {
      setViewportHeight(element.clientHeight);
    };

    handleScroll();
    handleResize();

    element.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      element.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [getScrollElement]);

  const virtualItems = useMemo(() => {
    if (count <= 0) return [] as VirtualItem[];
    const size = estimateSize();
    const viewport = viewportHeight || scrollElementRef.current?.clientHeight || 0;
    const overscanPx = overscan * size;
    const startIndex = Math.max(0, Math.floor((scrollOffset - overscanPx) / size));
    const endIndex = Math.min(
      count - 1,
      Math.ceil((scrollOffset + viewport + overscanPx) / size) - 1,
    );

    const items: VirtualItem[] = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
      const start = index * size;
      items.push({
        key: index,
        index,
        start,
        end: start + size,
        size,
      });
    }
    return items;
  }, [count, estimateSize, overscan, scrollOffset, viewportHeight]);

  const totalSize = useMemo(() => {
    const size = estimateSize();
    return size * count;
  }, [count, estimateSize]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const element = scrollElementRef.current;
      if (!element) return;
      const size = estimateSize();
      element.scrollTo({ top: index * size, behavior: 'smooth' });
    },
    [estimateSize],
  );

  return {
    getVirtualItems: () => virtualItems,
    getTotalSize: () => totalSize,
    scrollToIndex,
  };
}
