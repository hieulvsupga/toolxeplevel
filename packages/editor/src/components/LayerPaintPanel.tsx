import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { WALL_HEX } from '@voxel/core';
import { brickMaps, brickShade } from '../lib/brickTexture';
import { fillGridCell } from '../lib/wallCell';
import {
  canPasteSlice,
  copySlice,
  slicePasteTargets,
  type SliceClip,
} from '../lib/sliceClip';
import { useLayers } from '../lib/useLayers';
import { useEditor } from '../store';
import { ColorLegend } from './ColorLegend';
import { LayerListPanel } from './LayerListPanel';
import { PaletteSwatches } from './PaletteSwatches';

interface LayerPaintPanelProps {
  onClose: () => void;
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

const tmpMatrix = new THREE.Matrix4();
const tmpColor = new THREE.Color();
const _c = new THREE.Color();
const _bg = new THREE.Color('#16161c');
/** Làm mờ màu (trộn về nền) cho các lớp KHÔNG phải lớp đang sửa. */
function dimHex(hex: string): string {
  try {
    _c.set(hex).lerp(_bg, 0.72);
    return '#' + _c.getHexString();
  } catch {
    return hex;
  }
}

/**
 * Hoa văn gạch chéo cho ô "có khối nhưng đang bị ẩn" (layer tắt / bị lọc màu).
 *
 * Dùng `createPattern` với một ô mẫu px×px thay vì kẻ tay từng ô: kẻ tay phải `save/clip/restore`
 * cho mỗi ô, mà lưới thì vẽ lại mỗi lần nhích chuột. Ô mẫu đúng bằng một ô lưới nên hoa văn luôn
 * khớp mép ô (pattern lặp từ gốc canvas, mà mọi ô đều nằm ở toạ độ chia hết cho px).
 */
const hatchCache = new Map<number, CanvasPattern | null>();
function hatchPattern(ctx: CanvasRenderingContext2D, px: number): CanvasPattern | null {
  const hit = hatchCache.get(px);
  if (hit !== undefined) return hit;
  const tile = document.createElement('canvas');
  tile.width = px;
  tile.height = px;
  const tctx = tile.getContext('2d');
  let pattern: CanvasPattern | null = null;
  if (tctx) {
    tctx.fillStyle = '#2b2b34';
    tctx.fillRect(0, 0, px, px);
    tctx.strokeStyle = '#4d4d5c';
    tctx.lineWidth = 1.4;
    const gap = Math.max(4, Math.round(px / 3));
    for (let i = -px; i <= px * 2; i += gap) {
      tctx.beginPath();
      tctx.moveTo(i, px);
      tctx.lineTo(i + px, 0);
      tctx.stroke();
    }
    pattern = ctx.createPattern(tile, 'repeat');
  }
  hatchCache.set(px, pattern);
  return pattern;
}

interface Item {
  x: number;
  y: number;
  z: number;
  color: string;
  /**
   * Khối tường. Phải mang cờ riêng chứ không so `color === WALL_HEX` được: các lớp không phải lớp
   * đang sửa đã bị `dimHex` làm mờ nên hex của chúng không còn là hex tường nữa.
   */
  wall?: boolean;
  /** Lớp khác lớp đang sửa -> vẽ mờ. Với gạch thì làm mờ bằng độ sáng, không đổi hex. */
  dim?: boolean;
}

function PreviewMesh({ items }: { items: Item[] }) {
  const fit = useMemo(() => {
    if (!items.length) return { scale: 1, cx: 0, cy: 0, cz: 0 };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const it of items) {
      if (it.x < minX) minX = it.x;
      if (it.x > maxX) maxX = it.x;
      if (it.y < minY) minY = it.y;
      if (it.y > maxY) maxY = it.y;
      if (it.z < minZ) minZ = it.z;
      if (it.z > maxZ) maxZ = it.z;
    }
    const sx = maxX - minX + 1, sy = maxY - minY + 1, sz = maxZ - minZ + 1;
    return { scale: 12 / Math.max(sx, sy, sz), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2 };
  }, [items]);

  // Tường phải là mesh riêng để đeo vật liệu gạch — một instancedMesh chỉ có đúng một material.
  const [blocks, walls] = useMemo(
    () => [items.filter((it) => !it.wall), items.filter((it) => it.wall)],
    [items],
  );

  return (
    <group scale={fit.scale} position={[-fit.cx * fit.scale, -fit.cy * fit.scale, -fit.cz * fit.scale]}>
      <PreviewChunk items={blocks} />
      <PreviewChunk items={walls} wall />
    </group>
  );
}

/** Một mẻ khối cùng vật liệu trong khung xem trước. */
function PreviewChunk({ items, wall = false }: { items: Item[]; wall?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const brick = useMemo(() => (wall ? brickMaps() : null), [wall]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const cap = Math.max(1, items.length);
    if (!mesh.instanceColor || mesh.instanceColor.count !== cap) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    }
    for (let i = 0; i < items.length; i++) {
      tmpMatrix.setPosition(items[i].x, items[i].y, items[i].z);
      mesh.setMatrixAt(i, tmpMatrix);
      if (wall) {
        // Màu gạch nằm trong vân, nên instanceColor chỉ chỉnh sáng/tối. Lớp khác thì hạ sáng thay
        // vì trộn hex về màu nền như các khối màu — trộn hex sẽ làm mất sắc đỏ của gạch.
        const [x, y, z] = [items[i].x, items[i].y, items[i].z];
        tmpColor.setScalar(brickShade(x, y, z) * (items[i].dim ? 0.3 : 1));
      } else {
        tmpColor.set(items[i].color);
      }
      mesh.setColorAt(i, tmpColor);
    }
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items, wall]);

  return (
    <instancedMesh ref={ref} key={items.length} args={[undefined, undefined, Math.max(1, items.length)]}>
      <boxGeometry args={[1, 1, 1]} />
      {brick ? (
        <meshStandardMaterial
          map={brick.map}
          bumpMap={brick.bump}
          bumpScale={0.4}
          roughness={1}
          metalness={0}
        />
      ) : (
        <meshStandardMaterial roughness={0.8} metalness={0.05} />
      )}
    </instancedMesh>
  );
}

type AxisKey = 'x' | 'y' | 'z';

/**
 * Hướng cắt lớp để tô. Cùng một khối, cắt theo trục khác nhau thì lưới 2D là mặt phẳng khác nhau —
 * tô hình có chi tiết dọc (mặt người, chữ) bằng lớp ngang thì phải nhảy tầng liên tục, còn cắt dọc
 * là vẽ được cả chi tiết trên một mặt.
 *
 * `flipRow`: trục dọc của lưới vẽ ngược, giá trị LỚN ở trên. Bắt buộc khi trục dọc là z — không thì
 * hình hiện ra lộn đầu so với scene 3D.
 */
interface SliceAxis {
  key: AxisKey;
  label: string;
  /** Nhãn trên ô chọn hướng cắt — chỉ một chữ, vì ba ô nằm cạnh nhau nên trục là đủ để phân biệt. */
  short: string;
  dir: string;
  col: AxisKey;
  row: AxisKey;
  flipRow: boolean;
}

const SLICE_AXES: SliceAxis[] = [
  { key: 'z', label: 'Tầng Z', short: 'Z', dir: 'trên → dưới', col: 'x', row: 'y', flipRow: false },
  { key: 'x', label: 'Cột X', short: 'X', dir: 'trái → phải', col: 'y', row: 'z', flipRow: true },
  { key: 'y', label: 'Lớp Y', short: 'Y', dir: 'trước → sau', col: 'x', row: 'z', flipRow: true },
];

export function LayerPaintPanel({ onClose }: LayerPaintPanelProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const deleteCells = useEditor((s) => s.deleteCells);
  const stampVoxels = useEditor((s) => s.stampVoxels);
  const applyCells = useEditor((s) => s.applyCells);
  // Khối của layer đang tắt. Bảng này trước đây hiện và tô được mọi khối, nhưng thế thì lớp vừa
  // tắt cho khỏi che vẫn nằm trong lưới 2D và vẫn ăn nét tô — đúng chỗ dễ tô nhầm nhất.
  const { hiddenVoxels } = useLayers();
  // Lọc màu dùng CHUNG với scene chính (cột màu bên phải bảng này chỉ là một lối vào khác của nó).
  const colorFilter = useEditor((s) => s.colorFilter);

  /**
   * Ô có khối nhưng đang KHÔNG hiện: layer bị tắt, hoặc màu của nó bị lọc ra. Hai thứ này phải đi
   * cùng nhau ở mọi chỗ — vẽ lưới, xem trước 3D, và cả phần chặn nét tô — không thì lại thành tô
   * vào thứ mình không nhìn thấy.
   */
  const offAt = useMemo(() => {
    const keep = colorFilter.length ? new Set(colorFilter) : null;
    return (k: string, color: string | undefined) =>
      hiddenVoxels.has(k) || (!!keep && !!color && !keep.has(color));
  }, [hiddenVoxels, colorFilter]);

  // Bao đóng cả 3 trục + số khối trên từng lớp của TỪNG trục (để đổi hướng cắt là có sẵn số liệu).
  const bounds = useMemo(() => {
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };
    // `per` chỉ đếm khối ĐANG HIỆN (thứ tô được), `hidden` đếm phần bị layer tắt để còn nói ra.
    const per = { x: new Map<number, number>(), y: new Map<number, number>(), z: new Map<number, number>() };
    const hid = { x: new Map<number, number>(), y: new Map<number, number>(), z: new Map<number, number>() };
    for (const { x, y, z, voxel } of grid.entries()) {
      const v = { x, y, z };
      const off = offAt(key(x, y, z), voxel.color);
      for (const a of ['x', 'y', 'z'] as AxisKey[]) {
        // Hộp bao vẫn tính cả khối bị ẩn: tắt một layer mà lưới 2D co lại thì mọi ô xê dịch, đang
        // tô dở là mất dấu chỗ vừa tô.
        if (v[a] < min[a]) min[a] = v[a];
        if (v[a] > max[a]) max[a] = v[a];
        const m = off ? hid[a] : per[a];
        m.set(v[a], (m.get(v[a]) ?? 0) + 1);
      }
    }
    const valid = max.z >= min.z;
    // Lớp đông khối nhất của từng trục — mở panel ra là thấy ngay lớp đáng tô nhất.
    const most = { x: min.x, y: min.y, z: min.z };
    for (const a of ['x', 'y', 'z'] as AxisKey[]) {
      let best = -1;
      for (const [v, n] of per[a]) if (n > best) { best = n; most[a] = v; }
    }
    return { min, max, per, hid, valid, most };
  }, [grid, version, offAt]);

  const [axisKey, setAxisKey] = useState<AxisKey>('z');
  const axis = SLICE_AXES.find((a) => a.key === axisKey)!;
  // Lớp đang chọn nhớ RIÊNG cho từng trục: đổi hướng cắt rồi đổi lại thì vẫn về đúng lớp cũ.
  const [sliceByAxis, setSliceByAxis] = useState<Partial<Record<AxisKey, number>>>({});
  const setSlice = (v: number) => setSliceByAxis((prev) => ({ ...prev, [axisKey]: v }));

  const [clip, setClip] = useState<SliceClip | null>(null);
  /**
   * Đang giữ một tầng đã copy thì cho thanh trượt đi thêm 1 lớp ra ngoài hộp bao mỗi phía — chỗ để
   * dán thành TẦNG MỚI (nhân đôi sàn lên trên, kéo dài khối thêm một lớp). Không có clipboard thì
   * không mở, vì một lớp trống trơn chẳng để làm gì.
   */
  const canExtend = !!clip && clip.axis === axisKey;
  const sliceMin = bounds.min[axisKey] - (canExtend ? 1 : 0);
  const sliceMax = bounds.max[axisKey] + (canExtend ? 1 : 0);
  const cur = Math.max(sliceMin, Math.min(sliceMax, sliceByAxis[axisKey] ?? bounds.most[axisKey]));

  // CHỐT lớp đang xem ngay lần đầu vào mỗi trục.
  //
  // Trước đây khi chưa kéo thanh trượt thì lớp đang xem lấy theo `bounds.most` — lớp đông khối nhất
  // — mà `most` chỉ đếm khối ĐANG HIỆN, nên tắt hết màu của lớp đang tô là lớp đó rỗng và cả bảng
  // tự nhảy sang lớp khác. Chốt một lần rồi thì chỉ người dùng đổi lớp được thôi.
  useEffect(() => {
    if (!bounds.valid) return;
    setSliceByAxis((prev) =>
      prev[axisKey] === undefined ? { ...prev, [axisKey]: bounds.most[axisKey] } : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axisKey, bounds.valid]);

  /** Ô ứng với (cột, hàng) trên lưới 2D của lớp đang xem. */
  const cellAt = (c: number, r: number): [number, number, number] => {
    const v = { x: 0, y: 0, z: 0 };
    v[axis.col] = bounds.min[axis.col] + c;
    v[axis.row] = axis.flipRow ? bounds.max[axis.row] - r : bounds.min[axis.row] + r;
    v[axis.key] = cur;
    return [v.x, v.y, v.z];
  };

  const gridRef = useRef<HTMLCanvasElement>(null);
  const paintingRef = useRef(false);
  const anchorRef = useRef<{ c: number; r: number } | null>(null);
  const [paintMode, setPaintMode] = useState<'brush' | 'rect'>('brush');
  const [tool, setTool] = useState<'add' | 'erase'>('add');
  const strokeToolRef = useRef(tool);
  // Nét đang vẽ: key ô -> màu (chuỗi) hoặc null (xóa). Overlay xem trước, commit khi thả.
  const [pending, setPending] = useState<Map<string, string | null>>(new Map());

  const cols = bounds.valid ? bounds.max[axis.col] - bounds.min[axis.col] + 1 : 0;
  const rows = bounds.valid ? bounds.max[axis.row] - bounds.min[axis.row] + 1 : 0;

  // Vẽ lưới 2D của lớp hiện tại (hai trục của lưới đổi theo hướng cắt).
  useEffect(() => {
    const cv = gridRef.current;
    if (!cv || !bounds.valid) return;
    const px = 18;
    cv.width = cols * px;
    cv.height = rows * px;
    const ctx = cv.getContext('2d')!;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const [x, y, z] = cellAt(c, r);
        const k = key(x, y, z);
        const existing = grid.get(x, y, z)?.color;
        const off = existing !== undefined && offAt(k, existing);
        const pv = pending.get(k); // string = đặt màu, null = xóa, undefined = giữ nguyên
        const col = off ? null : pv !== undefined ? pv : (existing ?? null);
        if (col) {
          fillGridCell(ctx, c * px, r * px, px, col);
        } else if (off) {
          // Có khối nhưng đang ẩn: xám + gạch chéo. Để trống trơn thì bấm ➕ Thêm vào đó mà không
          // có gì xảy ra, nhìn như tool hỏng; còn tô màu thật thì lại tô nhầm vào nó.
          const hatch = hatchPattern(ctx, px);
          ctx.fillStyle = hatch ?? '#2b2b34';
          ctx.fillRect(c * px, r * px, px, px);
        } else {
          ctx.fillStyle = (r + c) % 2 ? '#20202a' : '#191921';
          ctx.fillRect(c * px, r * px, px, px);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, version, cur, axisKey, pending, bounds, cols, rows, offAt]);

  // Dữ liệu 3D: cả scene, đè màu pending, làm mờ các lớp khác.
  const previewItems = useMemo(() => {
    const items: Item[] = [];
    const seen = new Set<string>();
    for (const { x, y, z, voxel } of grid.entries()) {
      const k = key(x, y, z);
      seen.add(k);
      // Ẩn ở lưới thì cũng ẩn ở khung 3D, để hai bên khớp nhau và thấy được phần bên trong.
      if (offAt(k, voxel.color)) continue;
      const pv = pending.get(k);
      if (pv === null) continue; // xem trước: đã xóa
      const raw = pv !== undefined ? pv : voxel.color;
      // Nhận diện tường TRƯỚC khi làm mờ: sau dimHex thì hex không còn khớp hex tường nữa.
      const wall = raw === WALL_HEX;
      const dim = { x, y, z }[axisKey] !== cur;
      items.push({ x, y, z, color: dim && !wall ? dimHex(raw) : raw, wall, dim });
    }
    // Khối mới thêm (add) chưa có trong grid.
    for (const [k, val] of pending) {
      if (val === null || seen.has(k)) continue;
      const [x, y, z] = k.split(',').map(Number);
      const wall = val === WALL_HEX;
      const dim = { x, y, z }[axisKey] !== cur;
      items.push({ x, y, z, color: dim && !wall ? dimHex(val) : val, wall, dim });
    }
    return items;
  }, [grid, version, pending, cur, axisKey, offAt]);

  /** Trạng thái một ô của lưới cho phần copy/dán — gộp "có khối gì" và "có đang ẩn không". */
  const stateAt = (c: number, r: number) => {
    const [x, y, z] = cellAt(c, r);
    const col = grid.get(x, y, z)?.color ?? null;
    return { color: col, hidden: col !== null && offAt(key(x, y, z), col) };
  };

  const doCopy = () => {
    if (!bounds.valid) return;
    setClip(copySlice({ axis: axisKey, slice: cur, cols, rows, stateAt }));
  };

  /** Dán tầng đã copy vào tầng đang xem — gộp đúng 1 lần undo nhờ `applyCells`. */
  const doPaste = () => {
    if (!clip || !canPaste) return;
    const targets = slicePasteTargets(clip, { cols, rows, cellAt, stateAt });
    if (targets.length) applyCells(targets);
  };

  const canPaste = canPasteSlice(clip, axisKey, cols, rows);

  // Ctrl+C / Ctrl+V ngay trong bảng. Bắt ở pha CAPTURE và chặn tiếp: công cụ Chọn ngoài scene cũng
  // nghe hai tổ hợp này trên window, để nó chạy tiếp là một cú Ctrl+V dán luôn cụm khối đã copy
  // ngoài kia vào scene trong lúc người dùng tưởng mình đang dán tầng.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
      ) {
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== 'c' && k !== 'v') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (k === 'c') doCopy();
      else doPaste();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const commit = () => {
    setPending((prev) => {
      if (!prev.size) return prev;
      const t = strokeToolRef.current;
      if (t === 'erase') {
        const cells = [...prev.keys()].map((k) => k.split(',').map(Number) as [number, number, number]);
        deleteCells(cells);
      } else {
        const items = [...prev.entries()].map(([k, col]) => {
          const [x, y, z] = k.split(',').map(Number);
          return { x, y, z, color: col as string };
        });
        stampVoxels(items);
      }
      return new Map();
    });
  };

  /**
   * Ô chuột đang trỏ, trả về theo CHỈ SỐ LƯỚI (cột, hàng) chứ không phải toạ độ thế giới: hai trục
   * của lưới đổi theo hướng cắt, nên mọi phép tính vùng phải làm trên chỉ số rồi mới đổi ra toạ độ.
   */
  const gridPosFromEvent = (e: React.PointerEvent): { c: number; r: number } | null => {
    const cv = gridRef.current;
    if (!cv) return null;
    const rect = cv.getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * cols);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * rows);
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return { c, r };
  };

  // Giá trị chỉnh cho 1 ô theo công cụ: [key, màu|null] hoặc null nếu ô không hợp lệ.
  const editFor = ([x, y, z]: [number, number, number]): [string, string | null] | null => {
    const exists = !!grid.get(x, y, z);
    const k = key(x, y, z);
    // Khối đang bị ẩn (layer tắt hoặc lọc màu): không sơn, không xoá, và cũng không cho ➕ Thêm đè
    // lên (ô đó đang có khối, thêm vào là ghi đè màu một khối mình không nhìn thấy).
    if (exists && offAt(k, grid.get(x, y, z)?.color)) return null;
    if (tool === 'erase') return exists ? [k, null] : null;
    return [k, color]; // add: mọi ô trong lưới, kể cả ô đã có khối (đổi màu nó)
  };

  // Tô lẻ: thêm ô đang trỏ vào nét.
  const brushAt = (e: React.PointerEvent) => {
    const at = gridPosFromEvent(e);
    if (!at) return;
    const edit = editFor(cellAt(at.c, at.r));
    if (!edit) return;
    setPending((prev) => {
      if (prev.has(edit[0]) && prev.get(edit[0]) === edit[1]) return prev;
      const next = new Map(prev);
      next.set(edit[0], edit[1]);
      return next;
    });
  };

  // Tô vùng: hình chữ nhật từ ô neo tới ô đang trỏ.
  const rectTo = (e: React.PointerEvent) => {
    const at = gridPosFromEvent(e);
    const anchor = anchorRef.current;
    if (!at || !anchor) return;
    const c0 = Math.min(anchor.c, at.c);
    const c1 = Math.max(anchor.c, at.c);
    const r0 = Math.min(anchor.r, at.r);
    const r1 = Math.max(anchor.r, at.r);
    const next = new Map<string, string | null>();
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const edit = editFor(cellAt(c, r));
        if (edit) next.set(edit[0], edit[1]);
      }
    }
    setPending(next);
  };

  const onDown = (e: React.PointerEvent) => {
    paintingRef.current = true;
    strokeToolRef.current = tool;
    gridRef.current?.setPointerCapture(e.pointerId);
    if (paintMode === 'rect') {
      anchorRef.current = gridPosFromEvent(e);
      rectTo(e);
    } else {
      brushAt(e);
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!paintingRef.current) return;
    if (paintMode === 'rect') rectTo(e);
    else brushAt(e);
  };

  /**
   * Đánh số tầng theo THỨ TỰ (1…N) chứ không phải theo toạ độ: "tầng thứ 4 trên 7" là thứ người
   * dựng đếm được bằng mắt, còn toạ độ z thì âm dương tuỳ chỗ khối đứng.
   *
   * Đếm trên các tầng CÓ THẬT của khối, nên hai lớp trống thêm ra để dán tầng mới sẽ mang số 0 và
   * N+1 — kèm chữ "lớp mới" bên cạnh cho rõ.
   */
  const layerTotal = bounds.valid ? bounds.max[axisKey] - bounds.min[axisKey] + 1 : 0;
  const layerNo = cur - bounds.min[axisKey] + 1;
  const outside = cur < bounds.min[axisKey] || cur > bounds.max[axisKey];
  // Ô nhập giữ bản nháp riêng: đang gõ dở (rỗng, hay số chưa hợp lệ) thì không nhảy tầng ngay.
  const [layerDraft, setLayerDraft] = useState<string | null>(null);
  const commitLayerNo = (raw: string) => {
    const n = Math.round(Number(raw));
    setLayerDraft(null);
    if (!raw.trim() || !Number.isFinite(n)) return;
    const lo = sliceMin - bounds.min[axisKey] + 1;
    const hi = sliceMax - bounds.min[axisKey] + 1;
    setSlice(bounds.min[axisKey] + Math.max(lo, Math.min(hi, n)) - 1);
  };

  const countAtLayer = bounds.per[axisKey].get(cur) ?? 0;
  const hiddenAtLayer = bounds.hid[axisKey].get(cur) ?? 0;

  return createPortal(
    <div className="import-screen">
      <div className="import-topbar">
        {bounds.valid && (
          <>
            {/* Hướng cắt lớp. Cắt ngang (Z) tô được mặt trên; cắt dọc (X hoặc Y) tô được chi tiết
                đứng như mặt, chữ — thứ mà cắt ngang phải nhảy tầng liên tục mới vẽ nổi. */}
            <div className="tb-group">
              <span className="tb-glabel">Cắt theo</span>
              <div className="seg">
                {SLICE_AXES.map((a) => (
                  <button
                    key={a.key}
                    className={axisKey === a.key ? 'active' : ''}
                    onClick={() => setAxisKey(a.key)}
                    title={`${a.label}: cắt lớp theo trục ${a.key.toUpperCase()} (${a.dir}) — lưới 2D là mặt ${a.col.toUpperCase()}${a.row.toUpperCase()}`}
                  >
                    {a.short}
                  </button>
                ))}
              </div>
            </div>

            {/* Chọn lớp trên trục đang cắt */}
            <div className="tb-group">
              <span className="tb-glabel">{axis.label}</span>
              <button
                className="tb-icon"
                onClick={() => setSlice(cur - 1)}
                disabled={cur <= sliceMin}
                title={`Lùi một lớp (${axis.dir})`}
              >
                ◀
              </button>
              <button
                className="tb-icon"
                onClick={() => setSlice(cur + 1)}
                disabled={cur >= sliceMax}
                title={
                  canExtend
                    ? `Tiến một lớp (${axis.dir}) — đi được thêm 1 lớp trống ngoài khối để dán thành tầng mới`
                    : `Tiến một lớp (${axis.dir})`
                }
              >
                ▶
              </button>
              {/* "4 / 7" = tầng thứ 4 trên 7 tầng; gõ số vào ô là nhảy thẳng tới tầng đó. Số khối
                  và cỡ lưới nằm trong tooltip: đọc suốt cũng không dùng để làm gì, mà lại đẩy cả
                  nhóm này dài ra. */}
              <input
                className="num slice-num"
                type="number"
                min={sliceMin - bounds.min[axisKey] + 1}
                max={sliceMax - bounds.min[axisKey] + 1}
                value={layerDraft ?? String(layerNo)}
                title={`Tầng thứ ${layerNo} trên ${layerTotal} — gõ số để nhảy thẳng tới tầng đó`}
                onChange={(e) => setLayerDraft(e.target.value)}
                onBlur={(e) => commitLayerNo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitLayerNo((e.target as HTMLInputElement).value);
                  else if (e.key === 'Escape') setLayerDraft(null);
                }}
              />
              <span
                className="modal-dim"
                title={`${countAtLayer} khối ở tầng này${
                  hiddenAtLayer ? ` (+${hiddenAtLayer} đang ẩn)` : ''
                } · lưới ${cols}×${rows}`}
              >
                / {layerTotal}
                {outside ? ' · lớp mới' : ''}
              </span>
            </div>

            {/* Copy / dán cả tầng: dựng một tầng rồi nhân sang các tầng khác, khỏi tô lại từ đầu. */}
            <div className="tb-group">
              <span className="tb-glabel">Tầng</span>
              <button
                onClick={doCopy}
                title="Copy toàn bộ tầng đang xem (Ctrl+C) — chỉ lấy khối đang hiện"
              >
                ⧉ Copy
              </button>
              <button
                disabled={!canPaste}
                onClick={doPaste}
                title={
                  clip && !canPaste
                    ? 'Tầng đã copy thuộc hướng cắt khác (hoặc lưới đã đổi cỡ) — copy lại ở hướng này'
                    : 'Dán vào tầng đang xem, THAY cả tầng: sơn ô có màu, thêm ô trống, xoá ô dư (Ctrl+V). Khối đang ẩn không bị chạm. Một lần Ctrl+Z là hoàn tác hết.'
                }
              >
                📥 Dán
              </button>
            </div>

            {/* Công cụ */}
            <div className="tb-group">
              <span className="tb-glabel">Công cụ</span>
              <div className="seg">
                <button
                  className={tool === 'add' ? 'active' : ''}
                  onClick={() => setTool('add')}
                  title="Thêm khối: ô trống thì tạo khối màu đang chọn, ô đã có khối thì đổi sang màu đó"
                >
                  ➕ Thêm
                </button>
                <button
                  className={tool === 'erase' ? 'active' : ''}
                  onClick={() => setTool('erase')}
                  title="Xóa khối"
                >
                  🧹 Xóa
                </button>
              </div>
            </div>

            {/* Kiểu tô */}
            <div className="tb-group">
              <span className="tb-glabel">Kiểu</span>
              <div className="seg">
                <button
                  className={paintMode === 'brush' ? 'active' : ''}
                  onClick={() => setPaintMode('brush')}
                  title="Tô từng ô theo nét kéo"
                >
                  ✏️ Lẻ
                </button>
                <button
                  className={paintMode === 'rect' ? 'active' : ''}
                  onClick={() => setPaintMode('rect')}
                  title="Giữ & kéo để tô cả vùng chữ nhật"
                >
                  ▭ Vùng
                </button>
              </div>
            </div>

            {/* Bảng màu — chỉ 17 ô của game, không có ô chọn màu tuỳ ý. Màu ngoài bảng thì lúc xuất
                .asset phải dò về ColorType gần nhất, tức tô một màu rồi nhận về một màu khác. */}
            <div className="tb-group">
              <span className="tb-glabel">Màu</span>
              <div className="swatches">
                <PaletteSwatches />
              </div>
            </div>

            {/* Mechanic của khối — cùng lối vào như trên toolbar chính. Ô tường vốn nằm sẵn trong
                bảng màu bên cạnh nhưng không có nhãn, ở màn tô lớp lại càng khó đoán. */}
            <div className="tb-group">
              <span className="tb-glabel">Mechanic</span>
              {/* Chỉ còn viên gạch, không kèm chữ: nút này nằm ngay cạnh dãy ô màu nên đọc là hiểu,
                  mà thanh công cụ thì đã dài. Ý nghĩa đầy đủ vẫn ở tooltip. */}
              <button
                className={`tb-icon${color === WALL_HEX ? ' active' : ''}`}
                onClick={() => setColor(WALL_HEX)}
                title="Tường: khối không bao giờ bị phá, không súng nào bắn được, dùng để bịt hướng bắn — bấm rồi tô như màu thường"
              >
                🧱
              </button>
            </div>
          </>
        )}

        <div className="import-spacer" />
        <button className="tb-icon" onClick={onClose} title="Đóng bảng tô lớp">
          ✕
        </button>
      </div>

      <div className="layer-body">
        {/* Danh sách layer mang thẳng từ scene chính vào: bật/tắt ngay tại đây, và layer tắt thì
            biến khỏi cả lưới 2D lẫn khung 3D bên cạnh. */}
        <LayerListPanel embedded />
        <div className="layer-left">
          {bounds.valid ? (
            <canvas
              ref={gridRef}
              className="layer-canvas"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={() => {
                paintingRef.current = false;
                anchorRef.current = null;
                commit();
              }}
            />
          ) : (
            <div className="model-info">Chưa có khối nào trong scene để tô.</div>
          )}
        </div>
        <div className="layer-right">
          <Canvas
            camera={{ position: [16, -16, 13], fov: 45, up: [0, 0, 1] }}
            style={{ width: '100%', height: '100%' }}
          >
            <color attach="background" args={['#15151a']} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[10, 12, 20]} intensity={1.2} />
            <directionalLight position={[-10, -8, 5]} intensity={0.4} />
            <PreviewMesh items={previewItems} />
            <OrbitControls makeDefault enableDamping dampingFactor={0.1} target={[0, 0, 0]} />
          </Canvas>
        </div>
        {/* Cột màu: cùng bộ lọc màu với scene chính, nên tắt một màu ở đây thì ngoài kia cũng tắt. */}
        <ColorLegend embedded />
      </div>
    </div>,
    document.body,
  );
}
