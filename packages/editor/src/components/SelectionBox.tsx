import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { SELECT_COLOR } from './previewLines';
import { regionSize, useSelection, type Region } from './selectionStore';

/** Nới hộp ra một chút để cạnh không trùng mặt khối (trùng thì nhấp nháy). */
const PAD = 0.03;

/** 12 cạnh của hộp chọn theo toạ độ thế giới — ô [x] chiếm khoảng x..x+1. */
function boxEdges(r: Region): [number, number, number][] {
  const x0 = r.min[0] - PAD;
  const y0 = r.min[1] - PAD;
  const z0 = r.min[2] - PAD;
  const x1 = r.max[0] + 1 + PAD;
  const y1 = r.max[1] + 1 + PAD;
  const z1 = r.max[2] + 1 + PAD;
  const c: [number, number, number][] = [
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ];
  const pairs: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0], // đáy
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4], // nắp
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7], // cạnh đứng
  ];
  return pairs.flatMap(([a, b]) => [c[a], c[b]]);
}

/**
 * Hộp chọn đang có hiệu lực. Nét gạch đứt + `depthTest` tắt để luôn thấy được cả
 * khi vùng chọn bọc quanh khối — khung bị khối che thì không biết mình đang chọn đâu.
 */
export function SelectionBox() {
  const boxRegion = useSelection((s) => s.region);
  const pick = useSelection((s) => s.pick);
  // Chọn 2D cũng vẽ khung, nhưng là khung HỘP BAO của các khối đã chọn — để biết cụm đang chọn nằm
  // đâu trong scene. Phần khối nào được chọn thì `PickHighlight` lo.
  const region = pick ? pick.region : boxRegion;
  const points = useMemo(() => (region ? boxEdges(region) : []), [region]);

  if (!region) return null;
  const [sx, sy, sz] = regionSize(region);

  return (
    <group>
      {/* Không tô khối mờ cho chọn 2D: tập ô rời rạc thì hộp bao có thể trùm lên cả những khối
          không được chọn, tô vào là nói sai. */}
      {!pick && (
        <mesh
          position={[region.min[0] + sx / 2, region.min[1] + sy / 2, region.min[2] + sz / 2]}
          scale={[sx, sy, sz]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial color={SELECT_COLOR} transparent opacity={0.12} depthWrite={false} />
        </mesh>
      )}
      <Line
        points={points}
        segments
        dashed
        dashSize={0.45}
        gapSize={0.3}
        color={SELECT_COLOR}
        lineWidth={3}
        transparent
        opacity={0.95}
        depthTest={false}
        renderOrder={11}
      />
    </group>
  );
}
