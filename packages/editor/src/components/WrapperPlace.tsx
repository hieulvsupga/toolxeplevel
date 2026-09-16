import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { create } from 'zustand';
import { overlapsAnyWrapper } from '@voxel/core';
import { useEditor } from '../store';
import { useHoverBlock } from './hoverStore';
import { useInput } from './input';
import type { Cell } from './Voxels';

/** Trần một cạnh hộp, để một cú kéo lỡ tay không đẻ ra cái hộp dài vô tận. */
const MAX_SIDE = 64;

interface DragBox {
  min: Cell;
  max: Cell;
  /** Đang đè lên lớp bọc khác — thả ra cũng không đặt được. */
  blocked: boolean;
}

/**
 * Hộp đang kéo dở, để `HoverPreview` vẽ. Store riêng vì pointermove bắn liên tục — nhét vào store
 * chính là mỗi pixel lại render lại cả scene.
 */
export const useWrapperDrag = create<{
  box: DragBox | null;
  set: (box: DragBox | null) => void;
}>((set) => ({ box: null, set: (box) => set({ box }) }));

const clampSpan = (anchor: number, cur: number): [number, number] => {
  let lo = Math.min(anchor, cur);
  let hi = Math.max(anchor, cur);
  if (hi - lo + 1 > MAX_SIDE) {
    if (cur >= anchor) hi = anchor + MAX_SIDE - 1;
    else lo = anchor - MAX_SIDE + 1;
  }
  return [lo, hi];
};

/**
 * Công cụ ĐẶT LỚP BỌC: cầm sẵn một "khối tuỳ chỉnh" (loại + cỡ + hp + màu) rồi bấm phát nào ra hộp
 * phát đó — không phải kéo vùng chọn rồi bấm chuyển đổi cho từng cái.
 *
 * Bấm một cái = hộp đúng cỡ đang đặt. GIỮ VÀ KÉO = hộp DÀI RA theo hướng kéo (một cục to dần, khác
 * hẳn công cụ đặt khối thường vốn rải ra nhiều khối).
 *
 * Kéo trong mặt phẳng của chính cái mặt vừa bấm vào: bấm trên sàn thì kéo ngang theo X/Y, bấm vào
 * sườn khối thì kéo trong mặt đứng. GIỮ CTRL giữa chừng thì chuột chuyển sang điều khiển CHIỀU
 * VUÔNG GÓC mặt đó — đang kéo bề ngang thì Ctrl là kéo chiều cao, đang kéo trong mặt đứng thì Ctrl
 * là kéo bề sâu. Thả Ctrl ra là quay lại hai chiều cũ, phần vừa kéo được giữ nguyên.
 *
 * Chiều nào chưa đụng tới thì lấy theo cỡ ngòi, nên vẫn bấm một phát ra hộp đúng cỡ đã gõ.
 *
 * Khối lớn hợp với kiểu này vì nó KHÔNG cần bọc khối nào: trong game nó tự là một cục đặc, data
 * thật có cả level chỉ toàn khối lớn mà `layers` trống trơn.
 */
export function WrapperPlace() {
  const { gl, camera } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane();
    const hit = new THREE.Vector3();

    /**
     * Cú kéo đang diễn ra. `planeCur` là ô chuột chỉ tới trong mặt phẳng kéo, `normalCur` là ô theo
     * trục vuông góc (chỉ đổi khi giữ Ctrl). Giữ riêng hai giá trị để buông Ctrl ra thì phần vừa
     * kéo được không mất.
     */
    let drag:
      | { anchor: Cell; axis: 0 | 1 | 2; sign: 1 | -1; planeCur: Cell; normalCur: number | null }
      | null = null;

    const boxOf = (): DragBox => {
      const { wrapperBrush, wrappers } = useEditor.getState();
      const { anchor, axis, sign, planeCur, normalCur } = drag!;
      const size = [
        Math.max(1, wrapperBrush.size.x),
        Math.max(1, wrapperBrush.size.y),
        Math.max(1, wrapperBrush.size.z),
      ];
      const min: Cell = [0, 0, 0];
      const max: Cell = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        if (i === axis) {
          if (normalCur === null) {
            // Chưa đụng Ctrl: bề dày lấy từ ngòi, đi về phía mặt đang hướng ra.
            const b = anchor[i] + sign * (size[i] - 1);
            min[i] = Math.min(anchor[i], b);
            max[i] = Math.max(anchor[i], b);
          } else {
            [min[i], max[i]] = clampSpan(anchor[i], normalCur);
          }
        } else if (planeCur[i] === anchor[i]) {
          // Trục CHƯA kéo tới: giữ đúng cỡ ngòi. Nhờ vậy bấm một cái là ra hộp đúng cỡ đã gõ, và
          // kéo dài một chiều thì chiều kia vẫn giữ bề rộng của ngòi (không tóp lại còn 1 ô).
          min[i] = anchor[i];
          max[i] = anchor[i] + size[i] - 1;
        } else {
          [min[i], max[i]] = clampSpan(anchor[i], planeCur[i]);
        }
      }
      return {
        min,
        max,
        blocked: overlapsAnyWrapper(wrappers, {
          min: { x: min[0], y: min[1], z: min[2] },
          max: { x: max[0], y: max[1], z: max[2] },
        }),
      };
    };

    /** Ô mà tia chuột chỉ tới, TRONG mặt phẳng kéo (hai trục còn lại giữ nguyên theo ô neo). */
    const cellOnPlane = (e: PointerEvent): Cell | null => {
      if (!drag) return null;
      const rect = el.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      const n = new THREE.Vector3(0, 0, 0);
      n.setComponent(drag.axis, 1);
      // Mặt phẳng đi qua TÂM ô neo theo trục vuông góc.
      plane.setFromNormalAndCoplanarPoint(n, new THREE.Vector3(
        drag.anchor[0] + 0.5,
        drag.anchor[1] + 0.5,
        drag.anchor[2] + 0.5,
      ));
      // Nhìn gần như song song mặt phẳng thì giao điểm nhảy loạn — giữ nguyên hộp cũ.
      if (Math.abs(raycaster.ray.direction.dot(n)) < 0.08) return null;
      if (!raycaster.ray.intersectPlane(plane, hit)) return null;
      if (raycaster.ray.origin.distanceToSquared(hit) > 300 * 300) return null;
      const cur: Cell = [Math.floor(hit.x), Math.floor(hit.y), Math.floor(hit.z)];
      cur[drag.axis] = drag.anchor[drag.axis];
      return cur;
    };

    /**
     * Ô theo TRỤC VUÔNG GÓC mà chuột đang chỉ tới (lúc giữ Ctrl).
     *
     * Không raycast được vào mặt phẳng nào cả — chuột chỉ cho một tia, còn ta cần một điểm trên
     * đường thẳng dọc trục. Lấy điểm trên đường thẳng GẦN TIA NHẤT, đúng cách công cụ đặt khối tính
     * chiều cao khi giữ Ctrl.
     */
    const cellAlongNormal = (e: PointerEvent): number | null => {
      if (!drag) return null;
      const rect = el.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);

      const u = new THREE.Vector3(0, 0, 0);
      u.setComponent(drag.axis, 1);
      const c = new THREE.Vector3(
        drag.anchor[0] + 0.5,
        drag.anchor[1] + 0.5,
        drag.anchor[2] + 0.5,
      );
      const R = raycaster.ray.direction;
      const w0 = new THREE.Vector3().subVectors(c, raycaster.ray.origin);
      const b = u.dot(R);
      const denom = 1 - b * b;
      if (Math.abs(denom) < 1e-4) return null; // nhìn dọc đúng trục -> giữ nguyên
      const sc = (b * R.dot(w0) - u.dot(w0)) / denom;
      return Math.floor(c.getComponent(drag.axis) + sc);
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || useEditor.getState().mode !== 'wrapper') return;
      const { rotate, pan } = useInput.getState();
      if (rotate || pan) return; // đang giữ phím camera -> nhường

      const { target, targetNormal } = useHoverBlock.getState();
      if (!target) return;
      // Không biết mặt nào thì coi như mặt sàn — vẫn kéo ngang được.
      const n = targetNormal ?? [0, 0, 1];
      const axis = (n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2) as 0 | 1 | 2;
      drag = {
        anchor: [...target] as Cell,
        axis,
        sign: n[axis] >= 0 ? 1 : -1,
        planeCur: [...target] as Cell,
        normalCur: null,
      };
      useWrapperDrag.getState().set(boxOf());
      el.setPointerCapture(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      if (e.ctrlKey || e.metaKey) {
        // Ctrl: chuột chuyển sang kéo CHIỀU VUÔNG GÓC, hai chiều kia đứng yên ở chỗ vừa kéo được.
        const along = cellAlongNormal(e);
        if (along !== null) drag.normalCur = along;
      } else {
        const cur = cellOnPlane(e);
        if (cur) drag.planeCur = cur;
      }
      useWrapperDrag.getState().set(boxOf());
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0 || !drag) return;
      const box = useWrapperDrag.getState().box;
      drag = null;
      useWrapperDrag.getState().set(null);
      if (!box || box.blocked) return;
      const { wrapperBrush, addWrapper } = useEditor.getState();
      addWrapper(
        wrapperBrush.kind,
        { x: box.min[0], y: box.min[1], z: box.min[2] },
        { x: box.max[0], y: box.max[1], z: box.max[2] },
        wrapperBrush.hp,
        wrapperBrush.color,
      );
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && drag) {
        drag = null;
        useWrapperDrag.getState().set(null);
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
