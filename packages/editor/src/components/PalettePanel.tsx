import { useEditor } from '../store';

/** Panel setting bảng màu: sửa từng màu, thêm, xóa. */
export function PalettePanel() {
  const palette = useEditor((s) => s.palette);
  const setPaletteColor = useEditor((s) => s.setPaletteColor);
  const removePaletteColor = useEditor((s) => s.removePaletteColor);
  const addPaletteColor = useEditor((s) => s.addPaletteColor);

  return (
    <div className="palette-panel">
      <div className="pal-title">Bảng màu ({palette.length})</div>
      <div className="pal-list">
        {palette.map((c, i) => (
          <div className="pal-row" key={i}>
            <input
              type="color"
              value={c}
              onChange={(e) => setPaletteColor(i, e.target.value)}
              title="Đổi màu"
            />
            <span className="pal-hex">{c}</span>
            <button
              className="pal-del"
              onClick={() => removePaletteColor(i)}
              disabled={palette.length <= 1}
              title="Xóa màu"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button className="pal-add" onClick={addPaletteColor}>
        + Thêm màu
      </button>
    </div>
  );
}
