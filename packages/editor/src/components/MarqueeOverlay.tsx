import { useMarquee } from './marqueeStore';

/** Khung chữ nhật của chọn 2D, vẽ bằng DOM phủ lên canvas. */
export function MarqueeOverlay() {
  const rect = useMarquee((s) => s.rect);
  if (!rect) return null;
  return (
    <div
      className={`marquee${rect.add ? ' adding' : ''}`}
      style={{
        left: rect.x0,
        top: rect.y0,
        width: Math.max(0, rect.x1 - rect.x0),
        height: Math.max(0, rect.y1 - rect.y0),
      }}
    />
  );
}
