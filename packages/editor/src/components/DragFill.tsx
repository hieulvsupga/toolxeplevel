import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useEditor } from '../store';
import { MAX_SIDE, clampSpan, regionCells, useDrag } from './dragStore';

const UP = new THREE.Vector3(0, 0, 1);

/**
 * Giữ-kéo chuột trái: tô vùng chữ nhật ngang (4 hướng X/Y) ở tầng neo.
 * Giữ thêm Ctrl: di chuột lên/xuống để nâng/hạ chiều cao vùng.
 * Thả chuột thì fill; Esc huỷ.
 */
export function DragFill() {
  const { gl, camera } = useThree();

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane();
    const hit = new THREE.Vector3();

    const setRay = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, camera);
    };

    const onMove = (e: PointerEvent) => {
      const d = useDrag.getState().drag;
      if (!d) return;
      setRay(e);

      if (e.ctrlKey) {
        // ----- CHIỀU CAO: điểm gần nhất giữa tia chuột và trục đứng qua tâm đáy -----
        const [xMin, xMax] = clampSpan(d.anchorX, d.curX);
        const [yMin, yMax] = clampSpan(d.anchorY, d.curY);
        const C = new THREE.Vector3(
          (xMin + xMax + 1) / 2,
          (yMin + yMax + 1) / 2,
          d.baseZ + 0.5,
        );
        const R = raycaster.ray.direction;
        const O = raycaster.ray.origin;
        const w0 = new THREE.Vector3().subVectors(C, O);
        const b = UP.dot(R);
        const denom = 1 - b * b;
        if (Math.abs(denom) < 1e-4) return; // nhìn thẳng đứng -> giữ nguyên
        const sc = (b * R.dot(w0) - UP.dot(w0)) / denom;
        const zAtMouse = Math.floor(C.z + sc);
        if (zAtMouse >= d.baseZ) {
          useDrag.getState().setLayers(d.baseZ, Math.min(zAtMouse, d.baseZ + MAX_SIDE - 1));
        } else {
          useDrag.getState().setLayers(Math.max(zAtMouse, d.baseZ - MAX_SIDE + 1), d.baseZ);
        }
        return;
      }

      // ----- MẶT ĐÁY: raycast lên mặt phẳng ngang giữa tầng neo -----
      plane.set(UP, -(d.baseZ + 0.5));
      // Góc quá xiên: giao điểm nhảy loạn theo phối cảnh -> giữ vị trí cũ.
      if (Math.abs(raycaster.ray.direction.dot(plane.normal)) < 0.08) return;
      if (!raycaster.ray.intersectPlane(plane, hit)) return;
      if (raycaster.ray.origin.distanceToSquared(hit) > 300 * 300) return; // quá xa -> bỏ
      useDrag.getState().move(Math.floor(hit.x), Math.floor(hit.y));
    };

    const onUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const d = useDrag.getState().drag;
      if (!d) return;
      const { fill, paint, color } = useEditor.getState();
      const cells = regionCells(d);
      if (d.mode === 'remove') fill(cells, null);
      else if (d.mode === 'paint') paint(cells, color);
      else fill(cells, { color });
      useDrag.getState().clear();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useDrag.getState().drag) useDrag.getState().clear();
    };

    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
    };
  }, [gl, camera]);

  return null;
}
