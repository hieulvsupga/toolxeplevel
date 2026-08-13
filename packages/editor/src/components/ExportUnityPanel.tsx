import { useMemo } from 'react';
import {
  WALL_COLOR_ID,
  buildLayers,
  gameColorById,
  toUnityAsset,
  type LevelMeta,
  type Vec3,
} from '@voxel/core';
import { useEditor } from '../store';

interface ExportUnityPanelProps {
  onClose: () => void;
}

function Vec3Row({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: Vec3;
  onChange: (v: Vec3) => void;
  hint?: string;
}) {
  return (
    <label className="ex-row" title={hint}>
      <span className="ex-label">{label}</span>
      <span className="ex-vec">
        {(['x', 'y', 'z'] as const).map((axis) => (
          <input
            key={axis}
            type="number"
            step="0.1"
            value={value[axis]}
            onChange={(e) => onChange({ ...value, [axis]: Number(e.target.value) })}
          />
        ))}
      </span>
    </label>
  );
}

/** Xuất level ra file `.asset` (YAML ScriptableObject) để thả thẳng vào project Unity. */
export function ExportUnityPanel({ onClose }: ExportUnityPanelProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);

  // meta và depth ép tay nằm trong store, không phải state của panel: file .asset nhập vào đã mang
  // sẵn chúng, và panel này đóng/mở liên tục nên state cục bộ sẽ nuốt mất giá trị vừa nhập.
  const meta = useEditor((s) => s.levelMeta);
  const setMeta = useEditor((s) => s.setLevelMeta);
  const depthOverrides = useEditor((s) => s.depthOverrides);
  const setDepthOverrides = useEditor((s) => s.setDepthOverrides);
  const recenter = useEditor((s) => s.recenter);
  const setRecenter = useEditor((s) => s.setRecenter);

  const built = useMemo(
    () => buildLayers(grid, { recenter }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version, recenter],
  );

  // Áp depth ép tay rồi sắp lại. Mỗi dòng giữ luôn `autoKey` (depth tự động gốc) vì sắp lại làm
  // thứ tự lệch khỏi `built.layers`, mà ô nhập depth thì phải ghi đúng vào khoá cũ.
  // Format nguồn cho phép nhiều layer trùng (depth, colorType) — WallBox trong DataExample có 3
  // layer như vậy — nên không cần gộp lại khi ép depth làm hai layer đụng nhau.
  const rows = useMemo(() => {
    const applied = built.layers.map((layer) => {
      const autoKey = `${layer.depth}|${layer.colorType}`;
      const override = depthOverrides[autoKey];
      return { autoKey, layer: override === undefined ? layer : { ...layer, depth: override } };
    });
    return applied.sort(
      (a, b) => a.layer.depth - b.layer.depth || a.layer.colorType - b.layer.colorType,
    );
  }, [built.layers, depthOverrides]);

  const layers = useMemo(() => rows.map((r) => r.layer), [rows]);

  const set = <K extends keyof LevelMeta>(key: K, value: LevelMeta[K]) =>
    setMeta({ ...meta, [key]: value });

  const handleExport = () => {
    const blob = new Blob([toUnityAsset(layers, meta)], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.name || 'Level'}.asset`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const { bounds } = built;
  const size = bounds
    ? `${bounds.max.x - bounds.min.x + 1} × ${bounds.max.y - bounds.min.y + 1} × ${
        bounds.max.z - bounds.min.z + 1
      }`
    : '—';

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ex-modal">
        <div className="ex-head">
          <b>Xuất LevelData (.asset)</b>
          <button className="tb-icon" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="ex-summary">
          {built.voxelCount} khối · {layers.length} layer · depth 0…{built.maxDepth} · kích thước{' '}
          {size}
        </div>

        {built.approximatedColors.length > 0 && (
          <div className="ex-warn">
            {built.approximatedColors.length} màu không có trong bảng màu game, đã phải dò màu gần
            nhất:
            <ul>
              {built.approximatedColors.map((a) => (
                <li key={a.hex}>
                  <span className="pal-swatch" style={{ background: a.hex }} /> {a.hex} →{' '}
                  {a.mappedTo.name} ({a.count} khối)
                </li>
              ))}
            </ul>
            Sơn lại các khối này bằng bảng màu trong toolbar để khỏi bị đoán.
          </div>
        )}

        <div className="ex-section">Level</div>
        <label className="ex-row">
          <span className="ex-label">Tên</span>
          <input value={meta.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <div className="ex-grid">
          <label className="ex-row">
            <span className="ex-label">levelVersion</span>
            <input
              type="number"
              value={meta.levelVersion}
              onChange={(e) => set('levelVersion', Number(e.target.value))}
            />
          </label>
          <label className="ex-row">
            <span className="ex-label">dockCount</span>
            <input
              type="number"
              value={meta.dockCount}
              onChange={(e) => set('dockCount', Number(e.target.value))}
            />
          </label>
        </div>
        <label className="ex-row">
          <span className="ex-label">difficulty</span>
          <select
            value={meta.difficulty}
            onChange={(e) => set('difficulty', Number(e.target.value))}
          >
            <option value={0}>0 — Normal</option>
            <option value={1}>1 — Hard</option>
            <option value={2}>2 — VeryHard</option>
          </select>
        </label>
        <label className="ex-check">
          <input
            type="checkbox"
            checked={meta.shouldLoop}
            onChange={(e) => set('shouldLoop', e.target.checked)}
          />
          shouldLoop
        </label>
        <label className="ex-check">
          <input
            type="checkbox"
            checked={meta.shouldOfferMeteorShower}
            onChange={(e) => set('shouldOfferMeteorShower', e.target.checked)}
          />
          shouldOfferMeteorShower
        </label>

        <div className="ex-section">Đặt khối trong scene</div>
        <Vec3Row
          label="rootPosition"
          value={meta.rootPosition}
          onChange={(v) => set('rootPosition', v)}
        />
        <Vec3Row
          label="rootLocalEulerAngles"
          value={meta.rootLocalEulerAngles}
          onChange={(v) => set('rootLocalEulerAngles', v)}
          hint="Góc xoay khối khi dựng trong game — chỉnh ở đây để quay mặt cần bắn về phía camera"
        />
        <Vec3Row
          label="objectCenterPosition"
          value={meta.voxelizedObjectCenterPosition}
          onChange={(v) => set('voxelizedObjectCenterPosition', v)}
        />
        <Vec3Row
          label="objectShadowPosition"
          value={meta.voxelizedObjectShadowPosition}
          onChange={(v) => set('voxelizedObjectShadowPosition', v)}
        />
        <label className="ex-row">
          <span className="ex-label">objectScale</span>
          <input
            type="number"
            step="0.05"
            value={meta.voxelizedObjectScale}
            onChange={(e) => set('voxelizedObjectScale', Number(e.target.value))}
          />
        </label>

        <div className="ex-section">Khối</div>
        <label className="ex-check">
          <input
            type="checkbox"
            checked={recenter}
            onChange={(e) => setRecenter(e.target.checked)}
          />
          Dời khối về giữa gốc toạ độ
        </label>

        <div className="ex-note">
          Editor và LevelData dùng chung hệ trục (z là trục đứng) — toạ độ khối trong editor chính
          là toạ độ trong file, chỉ trừ phép dời tâm ở trên. depth tính tự động bằng cách bóc lớp
          từ vỏ vào (láng giềng 6 mặt); sửa số bên dưới để ép một layer mở khoá muộn hơn, như layer
          depth 12 trong Banana.asset.
        </div>

        <div className="ex-layers">
          {rows.map(({ layer, autoKey }) => {
            const color = gameColorById(layer.colorType);
            return (
              <div className="ex-layer" key={autoKey}>
                <input
                  type="number"
                  className="ex-depth"
                  value={layer.depth}
                  onChange={(e) =>
                    setDepthOverrides({ ...depthOverrides, [autoKey]: Number(e.target.value) })
                  }
                  title="depth"
                />
                <span className="pal-swatch" style={{ background: color?.hex ?? '#000' }} />
                <span className="ex-layer-name">
                  {layer.colorType === WALL_COLOR_ID ? 'Tường (None)' : color?.name}
                </span>
                <span className="ex-layer-count">{layer.voxelPositions.length}</span>
              </div>
            );
          })}
        </div>

        <button className="ex-go" onClick={handleExport} disabled={!built.voxelCount}>
          ⬇ Xuất {meta.name || 'Level'}.asset
        </button>
      </div>
    </div>
  );
}
