import { useEffect, useRef } from 'react';
import { useDrag } from './dragStore';

/** Nhãn "Esc để huỷ" bám theo con trỏ trong lúc đang kéo. */
export function DragHint() {
  const active = useDrag((s) => s.drag !== null);
  const ref = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      const el = ref.current;
      if (el) {
        el.style.left = `${e.clientX + 16}px`;
        el.style.top = `${e.clientY + 18}px`;
      }
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Đặt vị trí ngay khi bắt đầu kéo (theo vị trí chuột gần nhất).
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.left = `${pos.current.x + 16}px`;
      el.style.top = `${pos.current.y + 18}px`;
    }
  }, [active]);

  if (!active) return null;
  return (
    <div ref={ref} className="drag-hint">
      Ctrl: nâng/hạ • Esc: huỷ
    </div>
  );
}
