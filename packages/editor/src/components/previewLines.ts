import * as THREE from 'three';

/** Độ dày (pixel) của mọi khung minh họa: hover 1 ô và vùng đang kéo. */
export const PREVIEW_LINE_WIDTH = 4;

/** Màu mặc định của khung minh họa — trắng, không theo màu đang chọn trong palette. */
export const PREVIEW_COLOR = '#ffffff';

/**
 * Màu của thao tác chọn vùng. Khác hẳn trắng (đặt/kéo) và đỏ (xoá) để không bao giờ
 * nhầm "đang quét vùng chọn" với "đang tô khối".
 */
export const SELECT_COLOR = '#ffb454';

/**
 * 12 cạnh của khối hộp dưới dạng cặp điểm (không có đường chéo tam giác như
 * wireframe), dùng cho <Line segments> của drei.
 */
export function boxEdgePoints(size = 1): [number, number, number][] {
  const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(size, size, size));
  const pos = edges.getAttribute('position') as THREE.BufferAttribute;
  const out: [number, number, number][] = [];
  for (let i = 0; i < pos.count; i += 1) {
    out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  edges.dispose();
  return out;
}
