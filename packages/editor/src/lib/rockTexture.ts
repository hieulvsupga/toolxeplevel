import * as THREE from 'three';

/**
 * Vân đá cho khối tường, vẽ bằng canvas lúc chạy.
 *
 * Không dùng file ảnh: tool này chạy cả trong bản desktop đóng gói, thêm asset là thêm một đường
 * nữa có thể hỏng khi build. Vân sinh từ PRNG có hạt giống cố định nên lần chạy nào cũng ra đúng
 * một hình — mở lại project không thấy tường "đổi mặt".
 */

/** LCG nhỏ, cố định hạt giống để vân đá không đổi giữa các lần chạy. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SIZE = 128;

interface RockMaps {
  map: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
}

let cached: RockMaps | null = null;

function draw(): RockMaps {
  const random = rand(20240617);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = SIZE;
  const cc = colorCanvas.getContext('2d')!;

  // Bump vẽ song song cùng một hình: chỗ nào trên vân màu sáng/tối thì trên bump cũng nổi/lõm đúng
  // chỗ đó, nếu vẽ hai hình rời nhau thì ánh sáng sẽ đánh lệch với vệt màu.
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = bumpCanvas.height = SIZE;
  const bc = bumpCanvas.getContext('2d')!;

  // Vân phải SÁNG gần trắng: nó được nhân với màu xám của khối tường, nền vân xám nữa thì hai lần
  // nhân ra gần đen (đo lần đầu: 0.55 × 0.56 ≈ 0.31). Vân chỉ nên mang chi tiết, còn tông màu để
  // instanceColor lo.
  cc.fillStyle = '#eceded';
  cc.fillRect(0, 0, SIZE, SIZE);
  bc.fillStyle = '#808080';
  bc.fillRect(0, 0, SIZE, SIZE);

  // Đốm đá: nhiều đốm to nhỏ chồng nhau cho ra mặt đá lỗ chỗ.
  for (let i = 0; i < 900; i++) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const r = 1 + random() * 7;
    const shade = Math.round(170 + random() * 78);
    const alpha = 0.12 + random() * 0.3;
    cc.fillStyle = `rgba(${shade}, ${shade + 3}, ${shade + 9}, ${alpha})`;
    cc.beginPath();
    cc.arc(x, y, r, 0, Math.PI * 2);
    cc.fill();

    const bumpShade = Math.round(shade * 0.9 + 20);
    bc.fillStyle = `rgba(${bumpShade}, ${bumpShade}, ${bumpShade}, ${alpha})`;
    bc.beginPath();
    bc.arc(x, y, r, 0, Math.PI * 2);
    bc.fill();
  }

  // Vết nứt: vài đường gãy khúc sẫm màu, thứ làm cho nó ra "đá" chứ không phải "bê tông lấm chấm".
  for (let i = 0; i < 14; i++) {
    let x = random() * SIZE;
    let y = random() * SIZE;
    cc.strokeStyle = `rgba(92, 96, 104, ${0.35 + random() * 0.35})`;
    cc.lineWidth = 0.6 + random() * 1.4;
    bc.strokeStyle = `rgba(30, 30, 30, ${0.5 + random() * 0.3})`;
    bc.lineWidth = cc.lineWidth;
    cc.beginPath();
    bc.beginPath();
    cc.moveTo(x, y);
    bc.moveTo(x, y);
    const steps = 3 + Math.floor(random() * 4);
    for (let s = 0; s < steps; s++) {
      x += (random() - 0.5) * 34;
      y += (random() - 0.5) * 34;
      cc.lineTo(x, y);
      bc.lineTo(x, y);
    }
    cc.stroke();
    bc.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  const bump = new THREE.CanvasTexture(bumpCanvas);
  for (const texture of [map, bump]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    // Mỗi khối đúng 1 ô lưới nên để repeat 1: vân trải trọn một mặt khối, không bị cắt vụn.
    texture.repeat.set(1, 1);
    texture.anisotropy = 4;
  }
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, bump };
}

/** Vân đá dùng chung cho mọi khối tường (chỉ vẽ một lần). */
export function rockMaps(): RockMaps {
  if (!cached) cached = draw();
  return cached;
}

/**
 * Sắc độ hơi lệch cho từng khối, suy ra từ chính toạ độ ô.
 *
 * Cùng một vân dán lên mọi khối thì bức tường trông như dán giấy dán tường; lệch nhau một chút là
 * mắt đọc ra "nhiều tảng đá". Lấy theo toạ độ (không phải ngẫu nhiên lúc vẽ) nên khối nào giữ đúng
 * sắc độ của khối đó qua mọi lần render.
 */
export function rockShade(x: number, y: number, z: number): number {
  const h = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  return 0.82 + ((h >>> 8) % 1000) / 1000 * 0.36; // 0.82 .. 1.18
}
