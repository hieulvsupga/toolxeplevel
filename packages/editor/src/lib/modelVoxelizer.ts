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
          items.push({
            x: ix - offX,
            y: iy,
            z: iz - offZ,
            color: overrideColor ?? ded[idx - 1].color,
          });
        }
      }
    }
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
