import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { PalettePanel } from './PalettePanel';

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
  const palAreaRef = useRef<HTMLDivElement>(null);
  const [palOpen, setPalOpen] = useState(false);

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
      <div className="palette-area" ref={palAreaRef}>
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
          className={palOpen ? 'active' : ''}
          onClick={() => setPalOpen((o) => !o)}
          title="Quản lý bảng màu (thêm/sửa/xóa)"
        >
          ⚙ Màu
        </button>
        {palOpen && <PalettePanel />}
      </div>
      <div className="sep" />
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
      <div className="sep" />
      <button
        className={mirrorX ? 'active' : ''}
        onClick={() => toggleMirror('x')}
        title="Đối xứng qua mặt X"
      >
        ⇋ X
      </button>
      <button
        className={mirrorZ ? 'active' : ''}
        onClick={() => toggleMirror('z')}
        title="Đối xứng qua mặt Z"
      >
        ⇋ Z
      </button>
      <div className="sep" />
      <button onClick={undo} disabled={!canUndo} title="Hoàn tác (Ctrl+Z)">
        ↶ Undo
      </button>
      <button onClick={redo} disabled={!canRedo} title="Làm lại (Ctrl+Y)">
        ↷ Redo
      </button>
      <div className="sep" />
      <button onClick={handleExport} title="Xuất level ra JSON">
        ⬇ Export
      </button>
      <button onClick={() => fileRef.current?.click()} title="Nhập level từ JSON">
        ⬆ Import
      </button>
      <button onClick={() => count && confirm('Xóa toàn bộ level?') && clear()}>
        🗑 Clear
      </button>
      <span className="count">{count} khối</span>
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
