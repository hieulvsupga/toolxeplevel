import { useEffect } from 'react';
import { EditorScene } from './components/EditorScene';
import { Toolbar } from './components/Toolbar';
import { DragHint } from './components/DragHint';
import { ColorLegend } from './components/ColorLegend';
import { CoordHud } from './components/CoordHud';
import { LayerListPanel } from './components/LayerListPanel';
import { CenterPanel } from './components/CenterPanel';
import { SelectionPanel } from './components/SelectionPanel';
import { WrapperListPanel } from './components/WrapperListPanel';
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
      } else if (ctrl) {
        // Ctrl + chữ là tổ hợp của chỗ khác (Ctrl+C/V/D của vùng chọn, Ctrl+S của
        // hệ điều hành...) — không được rơi xuống mấy phím đổi công cụ bên dưới.
        return;
      } else if (e.key.toLowerCase() === 'b') {
        s.setMode('place');
      } else if (e.key.toLowerCase() === 'e') {
        s.setMode('remove');
      } else if (e.key.toLowerCase() === 'p') {
        s.setMode('paint');
      } else if (e.key.toLowerCase() === 's') {
        s.setMode('select');
      } else if (e.key.toLowerCase() === 'd') {
        s.setMode('select2d');
      } else if (e.key.toLowerCase() === 'w') {
        s.setMode('wrapper');
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
      <SelectionPanel />
      <WrapperListPanel />
      <div className="hint">
        <b>Chuột trái</b>: đặt/kéo khối ngang, <b>+Ctrl</b>: nâng/hạ chiều cao &nbsp;•&nbsp;
        giữ <b>X</b>: xóa, giữ <b>C</b>: hút màu &nbsp;•&nbsp;
        <b>B / E / P / S / D / W</b>: đặt / xóa / sơn / chọn vùng / chọn 2D / đặt lớp bọc &nbsp;•&nbsp;
        <b>Space/Alt + trái</b> hoặc <b>chuột phải</b>: xoay, <b>Shift + trái</b>: pan,
        <b>lăn</b>: zoom &nbsp;•&nbsp; <b>R</b>: reset, <b>F</b>: toàn cảnh &nbsp;•&nbsp;
        <b>Ctrl+Z / Y</b>: undo / redo &nbsp;•&nbsp; <b>Esc</b>: huỷ kéo &nbsp;•&nbsp;
        <b>F1</b>: hướng dẫn đầy đủ
      </div>
    </>
  );
}
