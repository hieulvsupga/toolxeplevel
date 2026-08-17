import { useEffect, useMemo, useRef, useState } from 'react';
import { WALL_HEX } from '@voxel/core';
import { useEditor } from '../store';
import { PalettePanel } from './PalettePanel';
import { ImportImagePanel } from './ImportImagePanel';
import { ImportModelPanel } from './ImportModelPanel';
import { LayerPaintPanel } from './LayerPaintPanel';
import { ExportUnityPanel } from './ExportUnityPanel';
import { BlasterPanel } from './BlasterPanel';

export function Toolbar() {
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const palette = useEditor((s) => s.palette);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const mirrorX = useEditor((s) => s.mirrorX);
  const mirrorY = useEditor((s) => s.mirrorY);
  const toggleMirror = useEditor((s) => s.toggleMirror);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const clear = useEditor((s) => s.clear);
  const canUndo = useEditor((s) => s.undoStack.length > 0);
  const canRedo = useEditor((s) => s.redoStack.length > 0);
  const count = useEditor((s) => s.grid.size);
  const version = useEditor((s) => s.version);
  const grid = useEditor((s) => s.grid);
  const blasterCount = useEditor((s) => s.blasters.length);

  const wallCount = useMemo(() => {
    let n = 0;
    for (const { voxel } of grid.entries()) if (voxel.color === WALL_HEX) n++;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, version]);
  const importUnityAsset = useEditor((s) => s.importUnityAsset);

  const fileRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const palAreaRef = useRef<HTMLDivElement>(null);
  const [palOpen, setPalOpen] = useState(false);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [layerOpen, setLayerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [blasterOpen, setBlasterOpen] = useState(false);

  // Click ra ngoài vùng bảng màu -> đóng popup.
  useEffect(() => {
    if (!palOpen) return;
    const onDown = (e: PointerEvent) => {
      if (palAreaRef.current && !palAreaRef.current.contains(e.target as Node)) {
        setPalOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [palOpen]);

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (count && !confirm(`Nhập "${file.name}" sẽ thay toàn bộ level đang mở. Tiếp tục?`)) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const warnings = importUnityAsset(String(reader.result));
        if (warnings.length) alert(`Đã nhập ${file.name}, có lưu ý:\n\n• ${warnings.join('\n• ')}`);
      } catch (err) {
        alert('Không đọc được file .asset: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="toolbar">
      {/* Màu */}
      <div className="tb-group palette-area" ref={palAreaRef}>
        <div className="swatches">
          {palette.map((c, i) => (
            <button
              key={i}
              className={`swatch${c === color ? ' active' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
        <button
          className={`tb-icon${palOpen ? ' active' : ''}`}
          onClick={() => setPalOpen((o) => !o)}
          title="Quản lý bảng màu (thêm/sửa/xóa)"
        >
          ⚙
        </button>
        {palOpen && <PalettePanel />}
      </div>

      {/* Công cụ (chọn 1) */}
      <div className="tb-group tb-seg">
        <button
          className={mode === 'place' ? 'active' : ''}
          onClick={() => setMode('place')}
          title="Đặt khối (B)"
        >
          ➕ Đặt
        </button>
        <button
          className={mode === 'remove' ? 'active' : ''}
          onClick={() => setMode('remove')}
          title="Xóa khối (E)"
        >
          ➖ Xóa
        </button>
        <button
          className={mode === 'paint' ? 'active' : ''}
          onClick={() => setMode('paint')}
          title="Sơn lại màu khối có sẵn (P)"
        >
          🖌 Sơn
        </button>
      </div>

      {/* Đối xứng */}
      <div className="tb-group">
        <button
          className={`tb-icon${mirrorX ? ' active' : ''}`}
          onClick={() => toggleMirror('x')}
          title="Đối xứng qua mặt X"
        >
          ⇋X
        </button>
        <button
          className={`tb-icon${mirrorY ? ' active' : ''}`}
          onClick={() => toggleMirror('y')}
          title="Đối xứng qua mặt Y"
        >
          ⇋Y
        </button>
      </div>

      {/* Lịch sử */}
      <div className="tb-group">
        <button className="tb-icon" onClick={undo} disabled={!canUndo} title="Hoàn tác (Ctrl+Z)">
          ↶
        </button>
        <button className="tb-icon" onClick={redo} disabled={!canRedo} title="Làm lại (Ctrl+Y)">
          ↷
        </button>
      </div>

      {/* Tạo khối từ */}
      <div className="tb-group">
        <button onClick={() => imgFileRef.current?.click()} title="Tạo khối từ ảnh 2D">
          🖼 Ảnh
        </button>
        <button
          onClick={() => modelFileRef.current?.click()}
          title="Tạo khối từ model 3D (.fbx .glb .gltf .obj .stl)"
        >
          🧊 Model
        </button>
      </div>

      {/* Tô màu theo tầng */}
      <div className="tb-group">
        <button onClick={() => count && setLayerOpen(true)} disabled={!count} title="Tô màu theo từng tầng (lưới 2D + xem 3D)">
          🎨 Tô tầng
        </button>
      </div>

      {/* Cơ chế của KHỐI (không phải của súng). Tường vốn vẽ được từ trước bằng ô màu xám đầu bảng
          màu, nhưng ô đó không có nhãn nên chẳng ai đoán ra — nút này chỉ là lối vào có tên. */}
      <div className="tb-group">
        <span className="tb-glabel">Khối</span>
        <button
          className={color === WALL_HEX ? 'active' : ''}
          onClick={() => setColor(WALL_HEX)}
          title="Tường: khối không bao giờ bị phá, không súng nào bắn được, dùng để bịt hướng bắn — bấm rồi vẽ như màu thường"
        >
          🧱 Tường{wallCount ? ` (${wallCount})` : ''}
        </button>
      </div>

      {/* Súng bắn + hàng chờ */}
      <div className="tb-group">
        <button
          className={blasterOpen ? 'active' : ''}
          onClick={() => setBlasterOpen((o) => !o)}
          title="Xếp súng bắn theo hàng, khớp số đạn với số khối từng màu"
        >
          🔫 Blaster{blasterCount ? ` (${blasterCount})` : ''}
        </button>
      </div>

      {/* File */}
      <div className="tb-group">
        <button
          onClick={() => fileRef.current?.click()}
          title="Mở file LevelData (.asset) của Unity vào tool"
        >
          Nhập .asset
        </button>
        <button
          onClick={() => count && setExportOpen(true)}
          disabled={!count}
          title="Ghi level hiện tại ra file LevelData (.asset) cho Unity"
        >
          Xuất .asset
        </button>
        <button
          className="tb-icon tb-danger"
          onClick={() => count && confirm('Xóa toàn bộ level?') && clear()}
          title="Xóa toàn bộ level"
        >
          🗑
        </button>
      </div>

      <span className="count">{count} khối</span>
      <input
        ref={imgFileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) setImgFile(f); // chọn xong ảnh mới vào trang import
        }}
      />
      {imgFile && (
        <ImportImagePanel initialFile={imgFile} onClose={() => setImgFile(null)} />
      )}
      <input
        ref={modelFileRef}
        type="file"
        accept=".fbx,.glb,.gltf,.obj,.stl"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) setModelFile(f);
        }}
      />
      {modelFile && (
        <ImportModelPanel initialFile={modelFile} onClose={() => setModelFile(null)} />
      )}
      {layerOpen && <LayerPaintPanel onClose={() => setLayerOpen(false)} />}
      {blasterOpen && <BlasterPanel onClose={() => setBlasterOpen(false)} />}
      {exportOpen && <ExportUnityPanel onClose={() => setExportOpen(false)} />}
      <input
        ref={fileRef}
        type="file"
        accept=".asset"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
    </div>
  );
}
