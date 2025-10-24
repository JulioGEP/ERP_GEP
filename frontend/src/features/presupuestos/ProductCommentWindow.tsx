import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { CloseButton } from 'react-bootstrap';

const VIEWPORT_MARGIN = 16;
const ESTIMATED_WIDTH = 380;
const ESTIMATED_HEIGHT = 260;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

type ProductCommentPayload = {
  productName: string;
  comment: string;
};

type Props = {
  show: boolean;
  productName: string | null;
  comment: string | null;
  onClose: () => void;
};

type Position = { left: number; top: number };

export function ProductCommentWindow({ show, productName, comment, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
  const [position, setPosition] = useState<Position>({ left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN });
  const titleId = useId();

  const clampPosition = useCallback(
    (left: number, top: number): Position => {
      if (typeof window === 'undefined') {
        return { left, top };
      }

      const dialog = containerRef.current;
      const dialogWidth = dialog?.offsetWidth ?? ESTIMATED_WIDTH;
      const dialogHeight = dialog?.offsetHeight ?? ESTIMATED_HEIGHT;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - dialogWidth - VIEWPORT_MARGIN);
      const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - dialogHeight - VIEWPORT_MARGIN);

      return {
        left: clamp(left, VIEWPORT_MARGIN, maxLeft),
        top: clamp(top, VIEWPORT_MARGIN, maxTop),
      };
    },
    []
  );

  const positionAtCenter = useCallback(() => {
    if (typeof window === 'undefined') return;

    setPosition((current) => {
      const dialog = containerRef.current;
      const dialogWidth = dialog?.offsetWidth ?? ESTIMATED_WIDTH;
      const dialogHeight = dialog?.offsetHeight ?? ESTIMATED_HEIGHT;

      const centeredLeft = (window.innerWidth - dialogWidth) / 2;
      const centeredTop = (window.innerHeight - dialogHeight) / 2;

      if (Number.isNaN(centeredLeft) || Number.isNaN(centeredTop)) {
        return current;
      }

      return clampPosition(centeredLeft, centeredTop);
    });
  }, [clampPosition]);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (pointerIdRef.current === null || pointerIdRef.current !== event.pointerId) return;
      const offset = dragOffsetRef.current;
      if (!offset) return;
      event.preventDefault();
      const nextLeft = event.clientX - offset.x;
      const nextTop = event.clientY - offset.y;
      setPosition(clampPosition(nextLeft, nextTop));
    },
    [clampPosition]
  );

  const stopDragging = useCallback(
    (event: PointerEvent) => {
      if (pointerIdRef.current === null || pointerIdRef.current !== event.pointerId) return;
      pointerIdRef.current = null;
      dragOffsetRef.current = null;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    },
    [handlePointerMove]
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      if (!containerRef.current) return;
      event.preventDefault();

      const rect = containerRef.current.getBoundingClientRect();
      dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      pointerIdRef.current = event.pointerId;

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', stopDragging);
      window.addEventListener('pointercancel', stopDragging);
    },
    [handlePointerMove, stopDragging]
  );

  useEffect(() => {
    if (!show) {
      pointerIdRef.current = null;
      dragOffsetRef.current = null;
      return;
    }

    positionAtCenter();
    const timer = window.setTimeout(positionAtCenter, 0);
    return () => window.clearTimeout(timer);
  }, [positionAtCenter, show]);

  useEffect(() => {
    if (!show) return;

    const handleResize = () => {
      setPosition((current) => clampPosition(current.left, current.top));
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [clampPosition, show]);

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
      window.removeEventListener('pointercancel', stopDragging);
    },
    [handlePointerMove, stopDragging]
  );

  if (!show) return null;
  if (typeof document === 'undefined') return null;

  const normalizedProduct = (productName ?? '').trim();
  const normalizedComment = (comment ?? '').trim();

  return createPortal(
    <>
      <div className="modal-backdrop fade show" style={{ zIndex: 1079 }} />
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-white rounded-4 shadow-lg border position-fixed"
        style={{
          left: position.left,
          top: position.top,
          zIndex: 1080,
          width: 'min(420px, calc(100vw - 32px))',
          maxHeight: 'min(70vh, calc(100vh - 32px))',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          className="px-4 py-3 border-bottom d-flex align-items-center justify-content-between gap-3"
          style={{ cursor: 'move', userSelect: 'none', touchAction: 'none' }}
          onPointerDown={handlePointerDown}
        >
          <h2 id={titleId} className="h6 mb-0">
            Comentario de la formación
          </h2>
          <CloseButton onClick={onClose} aria-label="Cerrar comentario de la formación" />
        </div>
        <div className="px-4 py-3 overflow-auto" style={{ whiteSpace: 'pre-wrap' }}>
          {normalizedProduct.length ? (
            <div className="mb-3">
              <strong>Formación:</strong> {normalizedProduct}
            </div>
          ) : null}
          {normalizedComment.length ? normalizedComment : 'Sin comentarios para este producto.'}
        </div>
      </div>
    </>,
    document.body
  );
}

export type { ProductCommentPayload };
