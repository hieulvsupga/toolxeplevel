import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import {
  cellsInScreenRect,
  isClick,
  mergeCells,
  normalizeRect,
  type ScreenRect,
} from '../lib/screenPick';
import { visibleCellFilter } from '../lib/useLayers';
import { useEditor } from '../store';
import { useInput } from './input';
import { useMarquee } from './marqueeStore';
import { livePickCells, pickFromCells, useSelection } from './selectionStore';

/**
 * Công cụ CHỌN 2D: giữ chuột trái kéo một khung trên màn hình, thả ra thì mọi khối có tâm chiếu vào
 * trong khung được chọn.
 *
 * Khác công cụ Chọn (hộp 3D): hộp 3D quét theo mặt sàn nên chọn được đúng một khối hộp, còn cái này
 * khoanh theo đúng hình mình thấy trên màn hình — muốn lấy cái đầu, cái tay, một mảng chéo thì hộp
 * 3D phải quét nhiều lần, còn ở đây một cú kéo là xong.
 *
 * Giữ Ctrl trong lúc kéo = THÊM vào vùng đang chọn. Không dùng Shift/Alt vì hai phím đó đã là
 * pan/xoay camera (xem `CameraRig`), giữ chúng thì chuột trái thuộc về camera chứ không phải khung.
 */
export function Marquee2D() {
  const { gl, camera } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    let start: { x: number; y: number } | null = null;
    let adding = false;

    const posOf = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const stop = () => {
      start = null;
      useMarquee.getState().set(null);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || useEditor.getState().mode !== 'select2d') return;
      const { rotate, pan, pick } = useInput.getState();
      if (rotate || pan || pick) return; // đang giữ phím camera / hút màu -> nhường
      start = posOf(e);
      adding = e.ctrlKey || e.metaKey;
      useMarquee.getState().set({ ...normalizeRect(start, start), add: adding });
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!start) return;
      useMarquee.getState().set({ ...normalizeRect(start, posOf(e)), add: adding });
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !start) return;
      const rect: ScreenRect = normalizeRect(start, posOf(e));
      stop();

      // Bấm một cái (không kéo) = bỏ chọn. Giữ Ctrl thì không, để lỡ tay bấm không mất vùng đang gom.
      if (isClick(rect)) {
        if (!adding) useSelection.getState().setPick(null);
        return;
      }

      const box = el.getBoundingClientRect();
      const v = new THREE.Vector3();
      const found = cellsInScreenRect(
        useEditor.getState().grid.entries(),
        rect,
        (x, y, z) => {
          // Chiếu TÂM khối: ô [x] chiếm khoảng x..x+1.
          v.set(x + 0.5, y + 0.5, z + 0.5).project(camera);
          return {
            x: (v.x * 0.5 + 0.5) * box.width,
            y: (-v.y * 0.5 + 0.5) * box.height,
            // z ngoài [-1,1] = nằm sau camera hoặc ngoài tầm nhìn; chiếu ra vẫn có toạ độ nhưng vô
            // nghĩa (điểm sau camera bị lộn ngược), chọn vào là chọn thứ mình không hề thấy.
            inFront: v.z >= -1 && v.z <= 1,
          };
        },
        // Khối đang bị ẩn (tắt layer / lọc màu) không được chọn, giống mọi thao tác khác.
        visibleCellFilter(),
      );

      const { pick, setPick } = useSelection.getState();
      const cells = adding && pick ? mergeCells(livePickCells(pick), found) : found;
      setPick(pickFromCells(cells));
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && start) {
        stop();
        // Đánh dấu Esc đã dùng cho việc huỷ cú kéo — SelectionPanel cũng nghe Esc để bỏ vùng chọn.
        e.preventDefault();
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, camera]);

  return null;
}
