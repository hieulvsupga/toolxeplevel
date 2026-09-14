/**
 * Voxel hóa model 3D (FBX / GLTF / GLB / OBJ / STL) thành các khối cube lấp đầy.
 *
 * Cách làm (solid voxelization bằng ray-casting theo cột):
 *  - Gom mọi tam giác của model về toạ độ world.
 *  - Với mỗi cột (ix,iz) bắn 1 tia dọc trục Y, lấy các điểm cắt mặt, sắp theo độ cao.
 *  - Ô nào có tâm nằm TRONG khối (số giao điểm phía dưới là lẻ) thì lấp cube.
 */
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

export type ModelExt = 'fbx' | 'gltf' | 'glb' | 'obj' | 'stl';

const EXTS: ModelExt[] = ['fbx', 'gltf', 'glb', 'obj', 'stl'];

export function isSupportedModel(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return !!ext && (EXTS as string[]).includes(ext);
}

/** Nạp model từ file, trả về Object3D (đã ở world matrix gốc). */
export async function loadModel(file: File): Promise<THREE.Object3D> {
  const ext = file.name.split('.').pop()?.toLowerCase() as ModelExt | undefined;
  const url = URL.createObjectURL(file);
  try {
    switch (ext) {
      case 'obj':
        return await new OBJLoader().loadAsync(url);
      case 'fbx':
        return await new FBXLoader().loadAsync(url);
      case 'gltf':
      case 'glb':
        return (await new GLTFLoader().loadAsync(url)).scene;
      case 'stl': {
        const geo = await new STLLoader().loadAsync(url);
        return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xcccccc }));
      }
      default:
        throw new Error('Định dạng chưa hỗ trợ: .' + ext);
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface TriData {
  a: THREE.Vector3[];
  b: THREE.Vector3[];
  c: THREE.Vector3[];
  color: string[];
  /** UV mỗi đỉnh (null nếu tam giác không có UV). */
  uvA: (THREE.Vector2 | null)[];
  uvB: (THREE.Vector2 | null)[];
  uvC: (THREE.Vector2 | null)[];
  hasUV: boolean;
  box: THREE.Box3;
}

/** Lấy màu từ ảnh texture theo toạ độ UV (wrap, lật V). */
export function makeTextureSampler(img: ImageData): (u: number, v: number) => string {
  const { width: W, height: H, data } = img;
  return (u, v) => {
    let uu = u - Math.floor(u);
    let vv = v - Math.floor(v);
    let px = Math.floor(uu * W);
    let py = Math.floor((1 - vv) * H); // ảnh gốc top-left, UV bottom-left
    if (px < 0) px = 0;
    else if (px >= W) px = W - 1;
    if (py < 0) py = 0;
    else if (py >= H) py = H - 1;
    const i = (py * W + px) * 4;
    return (
      '#' +
      [data[i], data[i + 1], data[i + 2]]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('')
    );
  };
}

// Nội suy UV tại điểm p trong tam giác (barycentric).
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
function uvAt(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  ua: THREE.Vector2,
  ub: THREE.Vector2,
  uc: THREE.Vector2,
  out: THREE.Vector2,
): void {
  _v0.subVectors(b, a);
  _v1.subVectors(c, a);
  _v2.subVectors(p, a);
  const d00 = _v0.dot(_v0);
  const d01 = _v0.dot(_v1);
  const d11 = _v1.dot(_v1);
  const d20 = _v2.dot(_v0);
  const d21 = _v2.dot(_v1);
  const denom = d00 * d11 - d01 * d01;
  if (!denom) {
    out.copy(ua);
    return;
  }
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  const u = 1 - v - w;
  out.set(ua.x * u + ub.x * v + uc.x * w, ua.y * u + ub.y * v + uc.y * w);
}

function meshColorHex(mesh: THREE.Mesh): string {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const col = (m as THREE.MeshStandardMaterial | undefined)?.color;
  return col ? '#' + col.getHexString() : '#cccccc';
}

/** Gom tam giác world-space + màu vật liệu + bbox. */
export function extractTriangles(object: THREE.Object3D): TriData {
  object.updateMatrixWorld(true);
  const a: THREE.Vector3[] = [];
  const b: THREE.Vector3[] = [];
  const c: THREE.Vector3[] = [];
  const color: string[] = [];
  const uvA: (THREE.Vector2 | null)[] = [];
  const uvB: (THREE.Vector2 | null)[] = [];
  const uvC: (THREE.Vector2 | null)[] = [];
  let hasUV = false;
  const box = new THREE.Box3();

  const vA = new THREE.Vector3();
  const vB = new THREE.Vector3();
  const vC = new THREE.Vector3();

  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry as THREE.BufferGeometry;
    const pos = geo.attributes.position as THREE.BufferAttribute | undefined;
    if (!pos) return;
    const uv = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const hex = meshColorHex(mesh);
    const mat = mesh.matrixWorld;
    const index = geo.index;
    const triCount = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      vA.fromBufferAttribute(pos, i0).applyMatrix4(mat);
      vB.fromBufferAttribute(pos, i1).applyMatrix4(mat);
      vC.fromBufferAttribute(pos, i2).applyMatrix4(mat);
      a.push(vA.clone());
      b.push(vB.clone());
      c.push(vC.clone());
      color.push(hex);
      if (uv) {
        uvA.push(new THREE.Vector2().fromBufferAttribute(uv, i0));
        uvB.push(new THREE.Vector2().fromBufferAttribute(uv, i1));
        uvC.push(new THREE.Vector2().fromBufferAttribute(uv, i2));
        hasUV = true;
      } else {
        uvA.push(null);
        uvB.push(null);
        uvC.push(null);
      }
      box.expandByPoint(vA).expandByPoint(vB).expandByPoint(vC);
    }
  });

  return { a, b, c, color, uvA, uvB, uvC, hasUV, box };
}

/** Kích thước lưới voxel (số ô mỗi trục) theo độ phân giải (cạnh dài nhất). */
export function gridDims(box: THREE.Box3, resolution: number): { nx: number; ny: number; nz: number; size: number } {
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const cell = maxDim / Math.max(1, resolution);
  return {
    nx: Math.max(1, Math.ceil(size.x / cell)),
    ny: Math.max(1, Math.ceil(size.y / cell)),
    nz: Math.max(1, Math.ceil(size.z / cell)),
    size: cell,
  };
}

export interface VoxelItem {
  x: number;
  y: number;
  z: number;
  color: string;
}

export interface VoxelizeOpts {
  /** Nếu có: mọi khối dùng đúng màu này. */
  overrideColor?: string;
  /** Nếu có (và model có UV): lấy màu từ texture theo UV mặt cắt. */
  sampler?: (u: number, v: number) => string;
  /**
   * Cỡ ảnh texture (px). Dùng để rải mẫu đủ dày so với hoạ tiết — thiếu nó thì mật độ mẫu chỉ theo
   * cỡ ô voxel và dễ bị aliasing. Xem `paintSurfaceColors`.
   */
  textureSize?: { width: number; height: number };
  /**
   * Tô màu theo MẶT model thay vì theo điểm tia cắt. Mặc định bật — xem `paintSurfaceColors` cho lý
   * do. false = quay về cách cũ (mỗi khối lấy đúng 1 pixel tại chỗ tia cắt mặt).
   */
  surfaceColors?: boolean;
}

/** Láng giềng 6 mặt, dùng để loang màu vào các khối trong lòng. */
const N6: [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const hexCache = new Map<string, [number, number, number]>();
function rgbOfHex(hex: string): [number, number, number] {
  let v = hexCache.get(hex);
  if (!v) {
    const n = parseInt(hex.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    if (hexCache.size < 65536) hexCache.set(hex, v);
  }
  return v;
}

const hexOfRgb = (r: number, g: number, b: number) =>
  '#' +
  [r, g, b]
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
    .join('');

/**
 * Khoá gộp phiếu: 5 bit mỗi kênh. Các pixel lệch nhau vài mức (nhiễu jpg, ánh sáng nướng vào ảnh)
 * rơi vào cùng một ô phiếu, nên chúng cộng phiếu cho nhau thay vì chia phiếu ra rồi cùng thua một
 * màu lạ chỉ chiếm vài pixel.
 */
const bucketOf = (r: number, g: number, b: number) =>
  ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

/**
 * Ngân sách mẫu mặt cho cả model — vượt thì nới bước lấy mẫu ra, chứ không bỏ tam giác nào. Đặt vừa
 * phải vì hàm này chạy lại mỗi lần đổi độ phân giải trong bảng xem trước.
 */
const SURFACE_SAMPLE_BUDGET = 800_000;
/**
 * Trần số lát chia một tam giác. Phải để cao: model ít mặt mà texture to (một tấm phẳng mang cả
 * ảnh 1024px) cần rất nhiều lát mới đủ 1 mẫu/texel — còn tổng số mẫu đã có ngân sách ở trên chặn.
 */
const MAX_TRI_SUBDIV = 1024;

/**
 * Tô màu từng khối theo MẶT model: rải mẫu dày trên mọi tam giác, mỗi mẫu bỏ một phiếu màu vào ô
 * voxel mà nó rơi vào, ô lấy màu THẮNG PHIẾU.
 *
 * Vì sao phải làm vậy: cách cũ lấy màu tại đúng điểm tia dọc trục Y cắt mặt, mỗi khối đúng 1 pixel
 * texture. Hai chỗ hụt, và cả hai đều nặng thêm khi độ phân giải thấp:
 *
 *  - 1 pixel không đại diện cho cả khối. Ở độ phân giải thấp, một khối trải trên hàng chục pixel
 *    texture; bốc đúng pixel ở tâm ô thì một đường viền, một vệt bẩn hay một pixel nhiễu cũng
 *    thành màu của cả khối. Lấy theo phiếu thì màu chiếm phần lớn diện tích khối mới thắng.
 *  - Tia chạy dọc Y nên các mặt ĐỨNG (sườn khối) bị cắt rất chéo: màu gán cho khối lấy từ chỗ tia
 *    cắt, cách xa chỗ khối thật sự nằm. Rải mẫu trên mặt thì mỗi khối nhận đúng màu ở đúng chỗ
 *    của nó, không phụ thuộc hướng tia.
 *
 * Khối trong lòng (không mặt nào chạm) thì loang màu từ khối vỏ gần nhất (BFS 6 mặt) — hợp với
 * cách game bóc dần từng lớp: lớp trong lộ ra vẫn cùng màu vùng vỏ ngay ngoài nó.
 */
function paintSurfaceColors(
  items: VoxelItem[],
  index: Map<string, number>,
  tri: TriData,
  grid: {
    min: THREE.Vector3;
    size: number;
    nx: number;
    ny: number;
    nz: number;
    offX: number;
    offZ: number;
  },
  sampler?: (u: number, v: number) => string,
  textureSize?: { width: number; height: number },
): void {
  const { a, b, c, color, uvA, uvB, uvC } = tri;
  const { min, size, nx, ny, nz, offX, offZ } = grid;
  if (!items.length || !a.length) return;

  /**
   * Số lát chia một tam giác, ở mật độ đầy (`spread` = 1). Lấy mức mịn hơn trong hai mức:
   *
   *  - theo KHỐI: mẫu cách nhau không quá nửa ô voxel, để ô nào có mặt đi qua cũng nhận được phiếu;
   *  - theo TEXTURE: mẫu cách nhau không quá 1 texel. Thiếu vế này là bỏ phiếu bị *aliasing*: mẫu
   *    thưa hơn hoạ tiết thì cả loạt mẫu rơi đúng vào một đường kẻ / đường viền trong ảnh, và cái
   *    màu chỉ chiếm 1/5 diện tích ô lại thắng phiếu. Đây chính là chỗ làm màu ra sai khi để độ
   *    phân giải thấp, và là lý do phải phóng ảnh thật to mới thấy đúng màu.
   */
  const subdivOf = (t: number, spread: number) => {
    const world = Math.max(
      a[t].distanceTo(b[t]),
      b[t].distanceTo(c[t]),
      c[t].distanceTo(a[t]),
    );
    let n = world / (size / 2);
    if (textureSize && uvA[t] && uvB[t] && uvC[t]) {
      const span = (p: THREE.Vector2, q: THREE.Vector2) =>
        Math.hypot((p.x - q.x) * textureSize.width, (p.y - q.y) * textureSize.height);
      n = Math.max(
        n,
        span(uvA[t]!, uvB[t]!),
        span(uvB[t]!, uvC[t]!),
        span(uvC[t]!, uvA[t]!),
      );
    }
    return Math.max(1, Math.min(MAX_TRI_SUBDIV, Math.ceil(n / spread)));
  };

  let total = 0;
  for (let t = 0; t < a.length; t++) {
    const n = subdivOf(t, 1);
    total += ((n + 1) * (n + 2)) / 2;
  }
  // Vượt ngân sách thì rải thưa đi cho vừa. Thưa đi vẫn hơn cách cũ (1 pixel cho cả khối); còn bỏ
  // tam giác là mất màu hẳn một vùng.
  const spread = total > SURFACE_SAMPLE_BUDGET ? Math.sqrt(total / SURFACE_SAMPLE_BUDGET) : 1;

  /** itemIndex -> (ô phiếu -> [tổng r, tổng g, tổng b, số phiếu]) */
  const votes = new Map<number, Map<number, [number, number, number, number]>>();

  for (let t = 0; t < a.length; t++) {
    const n = subdivOf(t, spread);
    const hasUV = !!(sampler && uvA[t] && uvB[t] && uvC[t]);
    const flat = hasUV ? null : rgbOfHex(color[t]);
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const wb = i / n;
        const wc = j / n;
        const wa = 1 - wb - wc;
        const px = a[t].x * wa + b[t].x * wb + c[t].x * wc;
        const py = a[t].y * wa + b[t].y * wb + c[t].y * wc;
        const pz = a[t].z * wa + b[t].z * wb + c[t].z * wc;
        const ix = Math.min(nx - 1, Math.max(0, Math.floor((px - min.x) / size)));
        const iy = Math.min(ny - 1, Math.max(0, Math.floor((py - min.y) / size)));
        const iz = Math.min(nz - 1, Math.max(0, Math.floor((pz - min.z) / size)));
        const idx = index.get(`${ix - offX},${iy},${iz - offZ}`);
        // Mẫu rơi vào ô KHÔNG được lấp (mặt đi sát mép ô, tâm ô nằm ngoài khối) -> bỏ, không tự
        // sinh thêm khối: phần hình do bước ray-casting quyết định, đây chỉ tô màu.
        if (idx === undefined) continue;

        let rgb: [number, number, number];
        if (hasUV) {
          const u = uvA[t]!.x * wa + uvB[t]!.x * wb + uvC[t]!.x * wc;
          const v = uvA[t]!.y * wa + uvB[t]!.y * wb + uvC[t]!.y * wc;
          rgb = rgbOfHex(sampler!(u, v));
        } else {
          rgb = flat!;
        }

        let bucket = votes.get(idx);
        if (!bucket) {
          bucket = new Map();
          votes.set(idx, bucket);
        }
        const key = bucketOf(rgb[0], rgb[1], rgb[2]);
        const acc = bucket.get(key);
        if (acc) {
          acc[0] += rgb[0];
          acc[1] += rgb[1];
          acc[2] += rgb[2];
          acc[3]++;
        } else {
          bucket.set(key, [rgb[0], rgb[1], rgb[2], 1]);
        }
      }
    }
  }
  if (!votes.size) return;

  // Chốt màu: ô phiếu nhiều nhất thắng, màu lấy TRUNG BÌNH của chính ô đó (không phải trung bình
  // tất cả) — trung bình tất cả thì hai màu tương phản trộn ra một màu thứ ba không có trong ảnh.
  const painted: number[] = [];
  for (const [idx, bucket] of votes) {
    let best: [number, number, number, number] | null = null;
    for (const acc of bucket.values()) {
      if (!best || acc[3] > best[3]) best = acc;
    }
    if (!best) continue;
    items[idx].color = hexOfRgb(best[0] / best[3], best[1] / best[3], best[2] / best[3]);
    painted.push(idx);
  }

  // Loang vào lòng khối.
  const known = new Uint8Array(items.length);
  for (const idx of painted) known[idx] = 1;
  for (let qi = 0; qi < painted.length; qi++) {
    const from = items[painted[qi]];
    for (const [dx, dy, dz] of N6) {
      const j = index.get(`${from.x + dx},${from.y + dy},${from.z + dz}`);
      if (j === undefined || known[j]) continue;
      known[j] = 1;
      items[j].color = from.color;
      painted.push(j);
    }
  }
}

/**
 * Voxel hóa. Ưu tiên màu: overrideColor > texture (sampler+UV) > màu vật liệu mặt.
 *
 * Trả về khối canh giữa quanh gốc, và LỚP THẤP NHẤT CÓ KHỐI nằm đúng tại y=0 — tức khối luôn đứng
 * chạm sàn. Mốc y=0 lấy theo hộp bao của model, mà hộp bao thì thường thấp hơn phần đặc: chóp nhọn,
 * mặt cong, hay một mặt phẳng lạc ở dưới đều kéo hộp bao xuống mà chẳng sinh ra khối nào. Không cắt
 * mấy lớp rỗng đó thì khối nhập vào bị kênh lên khỏi sàn một khoảng trống.
 */
export function voxelize(tri: TriData, resolution: number, opts: VoxelizeOpts = {}): VoxelItem[] {
  const { a, b, c, color, uvA, uvB, uvC, box } = tri;
  const { overrideColor, sampler } = opts;
  const { nx, ny, nz, size } = gridDims(box, resolution);
  const min = box.min;
  const offX = Math.floor(nx / 2);
  const offZ = Math.floor(nz / 2);
  const eps = size * 1e-3;

  const ray = new THREE.Ray();
  ray.direction.set(0, 1, 0);
  const hitPoint = new THREE.Vector3();
  const uvTmp = new THREE.Vector2();
  const items: VoxelItem[] = [];
  /** "x,y,z" (toạ độ của item) -> vị trí trong `items`, để bước tô màu theo mặt tìm được ô. */
  const index = new Map<string, number>();
  const surfaceColors = opts.surfaceColors !== false && !overrideColor;

  for (let ix = 0; ix < nx; ix++) {
    const wx = min.x + (ix + 0.5) * size;
    for (let iz = 0; iz < nz; iz++) {
      const wz = min.z + (iz + 0.5) * size;
      ray.origin.set(wx, min.y - size, wz);

      // Lấy tất cả giao điểm với mặt (không cull mặt sau).
      const hits: { y: number; color: string }[] = [];
      for (let t = 0; t < a.length; t++) {
        const p = ray.intersectTriangle(a[t], b[t], c[t], false, hitPoint);
        if (!p) continue;
        let col: string;
        if (overrideColor) {
          col = overrideColor;
        } else if (sampler && uvA[t] && uvB[t] && uvC[t]) {
          uvAt(hitPoint, a[t], b[t], c[t], uvA[t]!, uvB[t]!, uvC[t]!, uvTmp);
          col = sampler(uvTmp.x, uvTmp.y);
        } else {
          col = color[t];
        }
        hits.push({ y: hitPoint.y, color: col });
      }
      if (hits.length < 2) continue;
      hits.sort((h1, h2) => h1.y - h2.y);

      // Bỏ giao điểm trùng (cạnh chung) để giữ tính chẵn/lẻ đúng.
      const ded: { y: number; color: string }[] = [];
      for (const h of hits) {
        if (!ded.length || h.y - ded[ded.length - 1].y > eps) ded.push(h);
      }

      // Quét ô theo Y, ô nào có số giao điểm phía dưới là lẻ -> nằm trong.
      let idx = 0;
      for (let iy = 0; iy < ny; iy++) {
        const yc = min.y + (iy + 0.5) * size;
        while (idx < ded.length && ded[idx].y <= yc) idx++;
        if (idx % 2 === 1) {
          const x = ix - offX;
          const z = iz - offZ;
          if (surfaceColors) index.set(`${x},${iy},${z}`, items.length);
          items.push({
            x,
            y: iy,
            z,
            color: overrideColor ?? ded[idx - 1].color,
          });
        }
      }
    }
  }

  // Màu theo tia ở trên chỉ còn là dự phòng: khối nào có mặt model chạm vào đều được tô lại theo
  // phiếu, khối trong lòng thì loang từ vỏ. Xem `paintSurfaceColors`.
  if (surfaceColors) {
    paintSurfaceColors(
      items,
      index,
      tri,
      { min, size, nx, ny, nz, offX, offZ },
      sampler,
      opts.textureSize,
    );
  }

  return dropEmptyBottomLayers(items);
}

/**
 * Hạ khối xuống cho lớp thấp nhất CÓ KHỐI về y=0.
 *
 * Cắt mọi lớp rỗng liên tiếp ở đáy chứ không phải chỉ một lớp: model có phần dưới thuôn nhọn có thể
 * để trống vài lớp liền. Chỉ đụng đáy — phần trên giữ nguyên khoảng cách tương đối.
 */
function dropEmptyBottomLayers(items: VoxelItem[]): VoxelItem[] {
  let minY = Infinity;
  for (const it of items) {
    if (it.y < minY) minY = it.y;
  }
  if (!Number.isFinite(minY) || minY === 0) return items;
  for (const it of items) it.y -= minY;
  return items;
}
