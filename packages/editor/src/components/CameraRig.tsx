import { useEffect } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useEditor } from '../store';
import { useInput } from './input';

/**
 * Quản lý điều khiển camera:
 *  - Space/Alt + kéo trái  -> xoay (chuột trái vẫn để dựng khi không giữ phím)
 *  - Shift + kéo trái / chuột giữa -> pan
 *  - Chuột phải kéo -> xoay ; lăn -> zoom
 *  - R: reset view ; F: frame toàn bộ khối
 * Cũng cập nhật cờ trong useInput để phần dựng biết mà nhường thao tác.
 */
export function CameraRig() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useThree((s) => s.controls) as any;
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    if (!controls) return;
    controls.screenSpacePanning = true;

    const applyButtons = () => {
      const { rotate, pan } = useInput.getState();
      controls.mouseButtons.LEFT = rotate
        ? THREE.MOUSE.ROTATE
        : pan
          ? THREE.MOUSE.PAN
          : undefined;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    };
    applyButtons();

    const _v = new THREE.Vector3();
    const frameAll = () => {
      const grid = useEditor.getState().grid;
      const box = new THREE.Box3();
      let any = false;
      for (const { x, y, z } of grid.entries()) {
        box.expandByPoint(_v.set(x, y, z));
        box.expandByPoint(_v.set(x + 1, y + 1, z + 1));
        any = true;
      }
      if (!any) {
        controls.reset?.();
        return;
      }
      const center = box.getCenter(new THREE.Vector3());
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const fov = ((camera as THREE.PerspectiveCamera).fov * Math.PI) / 180;
      const dist = (sphere.radius / Math.sin(fov / 2)) * 1.2;
      const dir = camera.position.clone().sub(controls.target).normalize();
      if (dir.lengthSq() === 0) dir.set(1, 1, 1).normalize();
      controls.target.copy(center);
      camera.position.copy(center).add(dir.multiplyScalar(dist));
      controls.update();
    };

    const setFlag = (k: 'rotate' | 'pan', v: boolean) => {
      useInput.getState().setFlag(k, v);
      applyButtons();
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key;
      if (k === ' ' || k === 'Alt') {
        e.preventDefault();
        setFlag('rotate', true);
      } else if (k === 'Shift') {
        setFlag('pan', true);
      } else if (k === 'x' || k === 'X') {
        useInput.getState().setFlag('erase', true);
      } else if (k === 'c' || k === 'C') {
        useInput.getState().setFlag('pick', true);
      } else if (k === 'r' || k === 'R') {
        controls.reset?.();
      } else if (k === 'f' || k === 'F') {
        frameAll();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === ' ' || k === 'Alt') setFlag('rotate', false);
      else if (k === 'Shift') setFlag('pan', false);
      else if (k === 'x' || k === 'X') useInput.getState().setFlag('erase', false);
      else if (k === 'c' || k === 'C') useInput.getState().setFlag('pick', false);
    };
    const clearMods = () => {
      useInput.getState().setFlag('erase', false);
      useInput.getState().setFlag('pick', false);
      setFlag('rotate', false);
      setFlag('pan', false);
    };

    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clearMods);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clearMods);
    };
  }, [controls, camera]);

  return null;
}
