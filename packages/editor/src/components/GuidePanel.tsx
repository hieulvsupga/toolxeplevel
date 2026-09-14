import { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GUIDE, type GuideBlock, type GuideSection } from './guideContent';

interface GuidePanelProps {
  onClose: () => void;
}

/** Toàn bộ chữ của một mục, để lọc theo từ khoá. */
function sectionText(section: GuideSection): string {
  const parts = [section.title];
  for (const block of section.blocks) {
    if (block.kind === 'p' || block.kind === 'note') parts.push(block.text);
    else if (block.kind === 'keys') parts.push(...block.items.map((i) => `${i.k} ${i.d}`));
    else parts.push(...block.items);
  }
  return parts.join('\n').toLowerCase();
}

function Block({ block }: { block: GuideBlock }) {
  switch (block.kind) {
    case 'p':
      return <p className="gd-p">{block.text}</p>;
    case 'ul':
      return (
        <ul className="gd-ul">
          {block.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case 'steps':
      return (
        <ol className="gd-ol">
          {block.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ol>
      );
    case 'keys':
      return (
        <div className="gd-keys">
          {block.items.map((i) => (
            <div className="gd-key" key={i.k + i.d}>
              <kbd>{i.k}</kbd>
              <span>{i.d}</span>
            </div>
          ))}
        </div>
      );
    case 'note':
      return <div className="gd-note">{block.text}</div>;
  }
}

/**
 * Bảng hướng dẫn sử dụng: mục lục bên trái, nội dung bên phải, kèm ô lọc theo từ khoá.
 *
 * Nội dung nằm trong `guideContent.ts` dưới dạng dữ liệu — thêm mục chỉ cần sửa file đó, mục lục
 * và phần lọc tự có theo.
 */
export function GuidePanel({ onClose }: GuidePanelProps) {
  const [query, setQuery] = useState('');
  const docRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const sections = useMemo(
    () => (q ? GUIDE.filter((s) => sectionText(s).includes(q)) : GUIDE),
    [q],
  );

  // Cuộn trong khung nội dung, không phải cả trang: scrollIntoView mặc định kéo cả modal.
  const jump = (id: string) => {
    const doc = docRef.current;
    const target = doc?.querySelector<HTMLElement>(`[data-sec="${id}"]`);
    if (doc && target) doc.scrollTop = target.offsetTop - 8;
  };

  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal guide-modal">
        <div className="ex-head">
          <b>❔ Hướng dẫn sử dụng</b>
          <button className="tb-icon" onClick={onClose} title="Đóng (Esc)">
            ✕
          </button>
        </div>

        <input
          className="gd-search"
          placeholder="Lọc theo từ khoá — ví dụ: băng, khoang chờ, xoay, depth…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="guide-body">
          <div className="gd-nav">
            {sections.map((s) => (
              <button key={s.id} onClick={() => jump(s.id)}>
                {s.title}
              </button>
            ))}
            {sections.length === 0 && <span className="gd-nav-empty">không có mục nào khớp</span>}
          </div>

          <div className="gd-doc" ref={docRef}>
            {sections.map((s) => (
              <section data-sec={s.id} key={s.id}>
                <h3 className="gd-h">{s.title}</h3>
                {s.blocks.map((b, i) => (
                  <Block block={b} key={i} />
                ))}
              </section>
            ))}
            {sections.length > 0 && (
              <div className="gd-end">
                Hết. Chỗ nào trong tool cũng có tooltip khi trỏ chuột vào — đó là bản ngắn của
                những gì viết ở đây.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
