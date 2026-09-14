import { create } from 'zustand';
import type { ScreenRect } from '../lib/screenPick';

/**
 * Khung chọn 2D đang kéo, tính theo pixel của canvas.
 *
 * Phải đi qua store vì việc kéo nằm trong `<Canvas>` (cần camera để chiếu toạ độ) còn cái khung thì
 * là một thẻ DOM nằm ngoài Canvas — vẽ khung bằng SVG trong scene 3D thì nó sẽ xoay theo camera.
 */
interface MarqueeStore {
  rect: (ScreenRect & { add: boolean }) | null;
  set: (r: (ScreenRect & { add: boolean }) | null) => void;
}

export const useMarquee = create<MarqueeStore>((set) => ({
  rect: null,
  set: (rect) => set({ rect }),
}));
