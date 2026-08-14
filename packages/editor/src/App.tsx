import { useEffect } from 'react';
import { EditorScene } from './components/EditorScene';
import { Toolbar } from './components/Toolbar';
import { DragHint } from './components/DragHint';
import { ColorLegend } from './components/ColorLegend';
import { CoordHud } from './components/CoordHud';
import { LayerListPanel } from './components/LayerListPanel';
import { CenterPanel } from './components/CenterPanel';
import { useEditor } from './store';

export function App() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return; // đang gõ trong ô nhập liệu -> bỏ qua phím tắt
      const s = useEditor.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (ctrl && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (e.key.toLowerCase() === 'b') {
        s.setMode('place');
      } else if (e.key.toLowerCase() === 'e') {
        s.setMode('remove');
      } else if (e.key.toLowerCase() === 'p') {
        s.setMode('paint');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Toolbar />
      <EditorScene />
      <CoordHud />
      <LayerListPanel />
      <ColorLegend />
      <CenterPanel />
      <DragHint />
      <div className="hint">
        <b>Chuột trái</b>: đặt/kéo khối ngang, <b>+Ctrl</b>: nâng/hạ chiều cao &nbsp;•&nbsp;
        giữ <b>X</b>: xóa, giữ <b>C</b>: hút màu &nbsp;•&nbsp;
        <b>B / E / P</b>: đặt / xóa / sơn &nbsp;•&nbsp;
        <b>Space/Alt + trái</b> hoặc <b>chuột phải</b>: xoay, <b>Shift + trái</b>: pan,
        <b>lăn</b>: zoom &nbsp;•&nbsp; <b>R</b>: reset, <b>F</b>: toàn cảnh &nbsp;•&nbsp;
        <b>Ctrl+Z / Y</b>: undo / redo &nbsp;•&nbsp; <b>Esc</b>: huỷ kéo
      </div>
    </>
  );
}
