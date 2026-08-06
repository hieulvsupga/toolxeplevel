import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { PalettePanel } from './PalettePanel';
import { ImportImagePanel } from './ImportImagePanel';
import { ImportModelPanel } from './ImportModelPanel';
import { LayerPaintPanel } from './LayerPaintPanel';

export function Toolbar() {
  const color = useEditor((s) => s.color);
  const setColor = useEditor((s) => s.setColor);
  const palette = useEditor((s) => s.palette);
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const mirrorX = useEditor((s) => s.mirrorX);
  const mirrorZ = useEditor((s) => s.mirrorZ);
  const toggleMirror = useEditor((s) => s.toggleMirror);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const clear = useEditor((s) => s.clear);
  const canUndo = useEditor((s) => s.undoStack.length > 0);
  const canRedo = useEditor((s) => s.redoStack.length > 0);
  const count = useEditor((s) => s.grid.size);
  const exportJSON = useEditor((s) => s.exportJSON);
  const importJSON = useEditor((s) => s.importJSON);

  const fileRef = useRef<HTMLInputElement>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);
  const modelFileRef = useRef<HTMLInputElement>(null);
  const palAreaRef = useRef<HTMLDivElement>(null);
  const [palOpen, setPalOpen] = useState(false);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [layerOpen, setLayerOpen] = useState(false);

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

  const handleExport = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importJSON(String(reader.result));
      } catch (err) {
        alert('File level không hợp lệ: ' + (err as Error).message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
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
          className={`tb-icon${mirrorZ ? ' active' : ''}`}
          onClick={() => toggleMirror('z')}
          title="Đối xứng qua mặt Z"
        >
          ⇋Z
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

      {/* File */}
      <div className="tb-group">
        <button className="tb-icon" onClick={() => fileRef.current?.click()} title="Nhập level từ JSON">
          ⬆
        </button>
        <button className="tb-icon" onClick={handleExport} title="Xuất level ra JSON">
          ⬇
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
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImport}
      />
    </div>
  );
}
