import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AUTO_MECHANICS,
  MAX_DIFFICULTY_SCORE,
  difficultyLabel,
  levelDifficultyForScore,
  mechanicCountRange,
  mechanicsForScore,
  type AutoMechanicKey,
} from '@voxel/core';
import { useEditor } from '../store';

const LEVEL_DIFFICULTY_NAMES = ['Normal', 'Hard', 'VeryHard'];

interface AutoBuildDialogProps {
  defaultRowCount: number;
  defaultBullets: number;
  /** Điểm khó mở popup lên (thang 1..10). */
  defaultScore: number;
  /** Số khối bắn được — 0 thì không có gì để chia thành súng. */
  shootableBlocks: number;
  onClose: () => void;
  /** Báo lại kết quả để bảng blaster hiện một dòng tóm tắt. */
  onDone: (summary: string, notes: string[]) => void;
}

/**
 * Popup "tạo theo màu khối": chọn độ khó (random ra số lượng), chọn cơ chế và số lượng
 * từng cơ chế. Số đạn vẫn luôn khớp đúng số khối từng màu — đó là điều kiện thắng của màn,
 * không phải tuỳ chọn.
 */
export function AutoBuildDialog({
  defaultRowCount,
  defaultBullets,
  defaultScore,
  shootableBlocks,
  onClose,
  onDone,
}: AutoBuildDialogProps) {
  const autoBuildShooters = useEditor((s) => s.autoBuildShooters);
  const blasters = useEditor((s) => s.blasters);
  const levelMeta = useEditor((s) => s.levelMeta);
  const setLevelMeta = useEditor((s) => s.setLevelMeta);

  const [rowCount, setRowCount] = useState(Math.max(1, defaultRowCount));
  const [bullets, setBullets] = useState(defaultBullets);
  const [score, setScore] = useState(Math.min(MAX_DIFFICULTY_SCORE, Math.max(1, defaultScore)));
  const [enabled, setEnabled] = useState<AutoMechanicKey[]>(mechanicsForScore(defaultScore));
  // Giữ dạng chuỗi: ô rỗng = "tự random", khác hẳn số 0 = "không có cái nào".
  const [counts, setCounts] = useState<Partial<Record<AutoMechanicKey, string>>>({});
  const [applyDifficulty, setApplyDifficulty] = useState(true);

  /** Enum LevelDifficulty tương ứng điểm đang chọn — cùng ngưỡng mà tool dùng để chấm. */
  const levelDifficulty = levelDifficultyForScore(score);

  // Kéo thang điểm là nạp lại bộ cơ chế của mức đó và xoá các số gõ tay: mục đích của thang
  // là "random giúp tôi một bộ cỡ này", giữ lại số cũ thì kéo thang gần như không đổi gì.
  const pickScore = (value: number) => {
    setScore(value);
    setEnabled(mechanicsForScore(value));
    setCounts({});
  };

  const toggle = (key: AutoMechanicKey) =>
    setEnabled((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));

  const build = () => {
    if (
      blasters.length &&
      !confirm(`Tạo lại sẽ thay toàn bộ ${blasters.length} súng đang có. Tiếp tục?`)
    ) {
      return;
    }
    const mechanics: Partial<Record<AutoMechanicKey, number | null>> = {};
    for (const key of enabled) {
      const raw = (counts[key] ?? '').trim();
      const n = Number(raw);
      mechanics[key] = raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
    }
    const {
      applied,
      notes,
      score: got,
      label,
      winnable,
      layout,
    } = autoBuildShooters({
      rowCount: Math.max(1, rowCount),
      bulletsPerBlaster: Math.max(1, bullets),
      difficultyScore: score,
      mechanics,
    });
    if (applyDifficulty && levelMeta.difficulty !== levelDifficulty) {
      setLevelMeta({ ...levelMeta, difficulty: levelDifficulty });
    }
    const made = AUTO_MECHANICS.filter((m) => applied[m.key]).map(
      (m) => `${m.label.split(' ')[0]}${applied[m.key]}`,
    );
    // Điểm chấm được là con số đáng tin nhất ở đây (tính cả tường/số màu/độ sâu), nên nó
    // đứng đầu dòng tóm tắt, kèm mức đã đặt để thấy ngay lệch bao nhiêu.
    const gap = Math.abs(got - score) >= 0.5 ? ` (đặt ${score})` : '';
    onDone(
      `Đã tạo — điểm ${got}/10 ${label}${gap}` +
        `${winnable ? '' : ' · KHÔNG giải được'}` +
        `${made.length ? ` · ${made.join(' · ')}` : ' · không cơ chế'}` +
        `${layout === 'grouped' ? ' · hàng dồn cùng màu' : ''}`,
      notes,
    );
    onClose();
  };

  return createPortal(
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal ab-modal">
        <div className="ex-head">
          <b>⚡ Tạo súng theo màu khối</b>
          <button className="tb-icon" onClick={onClose} title="Đóng">
            ✕
          </button>
        </div>

        <div className="ex-summary">
          {shootableBlocks} khối bắn được — số đạn luôn chia khớp đúng số khối từng màu.
        </div>

        <div className="ex-section">Độ khó mục tiêu</div>
        <div className="ab-score">
          <input
            type="range"
            min={1}
            max={MAX_DIFFICULTY_SCORE}
            step={1}
            value={score}
            onChange={(e) => pickScore(Number(e.target.value))}
          />
          <span className="ab-score-num">{score}</span>
          <span className="ab-score-max">/ {MAX_DIFFICULTY_SCORE}</span>
          <span className="ab-score-label">{difficultyLabel(score)}</span>
        </div>
        <div className="ab-hint">
          Cùng thang điểm mà nút “Thử giải” chấm. Tool sinh nhiều phương án (bớt / giữ / nhồi thêm
          cơ chế × rải màu đều hay dồn cùng màu vào một hàng), tự chấm từng cái rồi giữ cái gần mức
          này nhất — nên tường bịt hướng bắn, số màu, số lớp phải bóc đều được tính vào, không chỉ
          riêng bộ súng. Phương án không giải được thì bị loại.
        </div>
        <label className="ab-check">
          <input
            type="checkbox"
            checked={applyDifficulty}
            onChange={(e) => setApplyDifficulty(e.target.checked)}
          />
          <span>
            Đặt luôn difficulty của level = {LEVEL_DIFFICULTY_NAMES[levelDifficulty]} (enum của
            game chỉ có 3 mức)
          </span>
        </label>

        <div className="ex-section">Chia súng</div>
        <div className="ab-fields">
          <label>
            <span>Hàng chờ</span>
            <input
              type="number"
              min={1}
              max={20}
              value={rowCount}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value.trim() && Number.isFinite(n) && n >= 1) setRowCount(Math.floor(n));
              }}
            />
          </label>
          <label>
            <span>Đạn/súng</span>
            <input
              type="number"
              min={1}
              value={bullets}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value.trim() && Number.isFinite(n) && n >= 1) setBullets(Math.floor(n));
              }}
            />
          </label>
        </div>

        <div className="ex-section">Cơ chế</div>
        <div className="ab-mechs">
          {AUTO_MECHANICS.map((m) => {
            const on = enabled.includes(m.key);
            // Cho thấy luôn thang điểm đang định random ra bao nhiêu, khỏi phải đoán.
            const [lo, hi] = mechanicCountRange(m.key, score);
            return (
              <div className={`ab-mech${on ? ' on' : ''}`} key={m.key}>
                <label className="ab-mech-head">
                  <input type="checkbox" checked={on} onChange={() => toggle(m.key)} />
                  <span className="ab-mech-name">{m.label}</span>
                  <input
                    className="ab-mech-count"
                    type="number"
                    min={0}
                    disabled={!on}
                    placeholder={lo === hi ? `random ${lo}` : `random ${lo}–${hi}`}
                    value={counts[m.key] ?? ''}
                    onChange={(e) => setCounts((c) => ({ ...c, [m.key]: e.target.value }))}
                  />
                  <span className="ab-mech-unit">{m.unit}</span>
                </label>
                <div className="ab-hint">{m.hint}</div>
              </div>
            );
          })}
        </div>
        <div className="ab-hint">
          Ô số để trống = random trong khoảng của mức điểm đang chọn. Bật cơ chế mà bàn không đủ
          khẩu hợp lệ thì nó dựng ít hơn và nói rõ thiếu bao nhiêu.
        </div>

        <div className="ab-actions">
          <button onClick={onClose}>Huỷ</button>
          <button className="bl-auto" disabled={!shootableBlocks} onClick={build}>
            ⚡ Tạo
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
