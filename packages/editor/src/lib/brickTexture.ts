import * as THREE from 'three';
import { drawBricks } from './brick';

/**
 * Vân gạch dán lên khối tường trong scene 3D, vẽ bằng canvas lúc chạy.
 *
 * Không dùng file ảnh: tool còn đóng gói thành bản desktop, thêm asset là thêm một đường nữa có thể
 * hỏng khi build. Hình gạch lấy chung hàm `drawBricks` với ô trên lưới 2D, nên tô ô nào thấy đúng
 * viên gạch đó hiện ra trong scene.
 */

const SIZE = 128;

interface BrickMaps {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

let cached: BrickMaps | null = null;

function draw(): BrickMaps {
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = SIZE;
  const cc = colorCanvas.getContext('2d')!;

  // Bump vẽ cùng một hình ở dạng thang xám: gạch nổi, mạch lõm. Vẽ rời hai hình thì ánh sáng đánh
  // lệch khỏi vệt màu.
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = bumpCanvas.height = SIZE;
  const bc = bumpCanvas.getContext('2d')!;

  drawBricks(cc, 0, 0, SIZE, { rows: 4 });
  drawBricks(bc, 0, 0, SIZE, { rows: 4, mono: true });

  const map = new THREE.CanvasTexture(colorCanvas);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  for (const texture of [map, bump]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Mỗi khối đúng 1 ô lưới nên repeat 1: vân trải trọn một mặt khối, không bị cắt vụn.
    texture.repeat.set(1, 1);
    texture.anisotropy = 4;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bump };
}

/** Vân gạch dùng chung cho mọi khối tường (chỉ vẽ một lần). */
export function brickMaps(): BrickMaps {
  if (!cached) cached = draw();
  return cached;
}

/**
 * Độ sáng hơi lệch cho từng khối, suy ra từ chính toạ độ ô.
 *
 * Cùng một vân dán lên mọi khối thì bức tường trông như dán giấy dán tường; lệch nhau một chút là
 * mắt đọc ra "nhiều tảng gạch". Lấy theo toạ độ (không phải ngẫu nhiên lúc vẽ) nên khối nào giữ
 * đúng sắc độ của khối đó qua mọi lần render.
 */
export function brickShade(x: number, y: number, z: number): number {
  const h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  return 0.88 + (((h >>> 8) % 1000) / 1000) * 0.24; // 0.88 .. 1.12
}
