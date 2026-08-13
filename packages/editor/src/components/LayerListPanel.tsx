import { useState } from 'react';
import { WALL_COLOR_ID, gameColorByHex } from '@voxel/core';
import { useEditor } from '../store';
import { useLayers, type LayerRow } from '../lib/useLayers';

type Cell = [number, number, number];

const cellsOf = (rows: LayerRow[]): Cell[] =>
  rows.flatMap((row) => row.positions.map((p) => [p.x, p.y, p.z] as Cell));

/**
 * Bên trái: danh sách layer đúng như sẽ ghi vào `LevelData.layers` — bật/tắt hiển thị, và sơn cả
 * layer hoặc cả depth bằng màu đang chọn trên toolbar.
 *
 * Tắt một layer chỉ ẩn nó khỏi màn hình — file .asset xuất ra vẫn có đủ. Nhưng khối bị ẩn thì
 * cũng không raycast được, nên không lỡ tay đặt/xóa nhầm vào lớp đang không nhìn thấy.
 */
export function LayerListPanel() {
  const { rows } = useLayers();
  const color = useEditor((s) => s.color);
  const hiddenLayers = useEditor((s) => s.hiddenLayers);
  const toggleLayer = useEditor((s) => s.toggleLayer);
  const soloLayer = useEditor((s) => s.soloLayer);
  const showAllLayers = useEditor((s) => s.showAllLayers);
  const recolorCells = useEditor((s) => s.recolorCells);

  const [open, setOpen] = useState(true);

  if (!rows.length) return null;

  const allKeys = rows.map((r) => r.key);
  const hiddenCount = hiddenLayers.length;
  const currentName = gameColorByHex(color)?.name ?? color;

  if (!open) {
    return (
      <button
        className={`layer-list layer-chip${hiddenCount ? ' filtering' : ''}`}
        onClick={() => setOpen(true)}
        title="Mở danh sách layer"
      >
        ▤ {rows.length}
      </button>
    );
  }

  // Gom theo depth HIỂN THỊ (đã áp ép tay) — đúng cách các layer sẽ nằm cạnh nhau trong file.
  const byDepth: { depth: number; rows: LayerRow[] }[] = [];
  for (const row of rows) {
    const last = byDepth[byDepth.length - 1];
    if (last && last.depth === row.depth) last.rows.push(row);
    else byDepth.push({ depth: row.depth, rows: [row] });
  }

  return (
    <div className="layer-list">
      <div className="layer-head">
        <span title={`${rows.length} layer sẽ được ghi vào LevelData.layers`}>
          {rows.length} layer
        </span>
        <span className="legend-head-actions">
          {hiddenCount > 0 && (
            <button className="link-btn" onClick={showAllLayers} title="Hiện lại tất cả">
              tất cả
            </button>
          )}
          <button className="link-btn legend-collapse" onClick={() => setOpen(false)} title="Thu gọn">
            ‹
          </button>
        </span>
      </div>

      <div className="layer-rows">
        {byDepth.map((group) => {
          const groupKeys = group.rows.map((r) => r.key);
          const groupHidden = groupKeys.every((k) => hiddenLayers.includes(k));
          const someHidden = groupKeys.some((k) => hiddenLayers.includes(k));
          const groupCount = group.rows.reduce((s, r) => s + r.count, 0);
          return (
            <div className="layer-group" key={group.depth}>
              <div className={`layer-depth-row${groupHidden ? ' hidden' : ''}`}>
                <input
                  type="checkbox"
                  className="layer-check"
                  checked={!groupHidden}
                  // Tắt/bật lẻ vài layer trong depth -> ô này về trạng thái lửng, để nhìn là biết
                  // depth đang hiện dở chứ không phải hiện đủ.
                  ref={(el) => {
                    if (el) el.indeterminate = someHidden && !groupHidden;
                  }}
                  onChange={() =>
                    groupKeys.forEach((k) => {
                      // Theo đúng nết của checkbox: đang lửng hoặc đang tắt -> bật hết; đang bật
                      // đủ -> tắt hết.
                      const isHidden = hiddenLayers.includes(k);
                      if (someHidden ? isHidden : !isHidden) toggleLayer(k);
                    })
                  }
                  title={someHidden ? 'Hiện cả depth này' : 'Ẩn cả depth này'}
                />
                <button
                  className="layer-paint depth"
                  onClick={() => recolorCells(cellsOf(group.rows), color)}
                  title={`Sơn toàn bộ ${groupCount} khối ở depth ${group.depth} thành ${currentName}`}
                >
                  <span className="layer-depth-label">depth {group.depth}</span>
                  <span className="layer-count">{groupCount}</span>
                </button>
              </div>

              {group.rows.map((row) => {
                const hidden = hiddenLayers.includes(row.key);
                const name = row.colorType === WALL_COLOR_ID ? 'Tường' : (row.color?.name ?? '?');
                return (
                  <div className={`layer-row${hidden ? ' hidden' : ''}`} key={row.key}>
                    <input
                      type="checkbox"
                      className="layer-check"
                      checked={!hidden}
                      onChange={() => toggleLayer(row.key)}
                      title={hidden ? 'Hiện layer này' : 'Ẩn layer này'}
                    />
                    <button
                      className="layer-paint"
                      onClick={() => recolorCells(cellsOf([row]), color)}
                      title={`Sơn cả ${row.count} khối của layer này thành ${currentName}`}
                    >
                      <span className="pal-swatch" style={{ background: row.color?.hex ?? '#000' }} />
                      <span className="layer-name">{name}</span>
                      <span className="layer-count">{row.count}</span>
                    </button>
                    <button
                      className="link-btn layer-solo"
                      onClick={() => soloLayer(row.key, allKeys)}
                      title="Chỉ hiện mình layer này (bấm lại để bỏ)"
                    >
                      ◉
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="layer-foot">
        Bấm vào dòng để sơn bằng
        <span className="pal-swatch" style={{ background: color }} />
        {currentName}
      </div>
    </div>
  );
}
