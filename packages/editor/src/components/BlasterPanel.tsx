import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BLASTER_TYPES,
  GAME_COLORS,
  WALL_COLOR_ID,
  blockCountsByColor,
  checkWinnable,
  colorBalance,
  gameColorById,
  rateDifficulty,
  validateShooters,
  type DifficultyReport,
  type SolveResult,
} from '@voxel/core';
import { useEditor } from '../store';

interface BlasterPanelProps {
  onClose: () => void;
}

/** Màu chọn được cho súng: cả bảng màu game trừ ô tường (tường không bao giờ là mục tiêu). */
const SHOOTABLE_COLORS = GAME_COLORS.filter((c) => c.id !== WALL_COLOR_ID);

const DIFFICULTY_NAMES = ['Normal', 'Hard', 'VeryHard'];

/**
 * Bảng xếp blaster, neo ở góc trên bên phải scene (không phải popup — để vừa xếp súng vừa xoay
 * khối mà nhìn được cả hai).
 *
 * Mỗi hàng chờ vẽ thành một CỘT DỌC, xếp cạnh nhau từ trái sang — đúng như lúc chơi, và đúng tên
 * của trường trong data (`dockColumns`). Ô trên cùng là phần tử đầu của hàng.
 *
 * Phép kiểm chính là tổng `bulletCount` theo từng màu phải bằng đúng số khối cùng màu — đo trên 7
 * file trong DataExample thì mọi màn đều khớp tuyệt đối, vì điều kiện thắng là bắn hết khối.
 */
export function BlasterPanel({ onClose }: BlasterPanelProps) {
  const grid = useEditor((s) => s.grid);
  const version = useEditor((s) => s.version);
  const blasters = useEditor((s) => s.blasters);
  const dockColumns = useEditor((s) => s.dockColumns);
  const setDockRowCount = useEditor((s) => s.setDockRowCount);
  const addBlaster = useEditor((s) => s.addBlaster);
  const updateBlaster = useEditor((s) => s.updateBlaster);
  const changeBlasterId = useEditor((s) => s.changeBlasterId);
  const removeBlaster = useEditor((s) => s.removeBlaster);
  const moveBlaster = useEditor((s) => s.moveBlaster);
  const autoBuildShooters = useEditor((s) => s.autoBuildShooters);
  const clearShooters = useEditor((s) => s.clearShooters);
  const levelMeta = useEditor((s) => s.levelMeta);
  const setLevelMeta = useEditor((s) => s.setLevelMeta);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bulletsPerBlaster, setBulletsPerBlaster] = useState(40);
  // Neo panel ngay dưới toolbar. Phải đo thay vì đặt cứng: toolbar xuống dòng theo bề rộng cửa sổ
  // (bảng màu 17 ô hay tràn thành 2 hàng), nên một con số cố định sẽ đè lên nó ở khổ này hoặc để
  // hở một khoảng trống ở khổ khác.
  const [top, setTop] = useState(56);
  // Ô id gõ tay: giữ bản nháp riêng để đang gõ dở (rỗng, trùng id khác) không ghi ngay vào store.
  const [idDraft, setIdDraft] = useState('');
  const [idError, setIdError] = useState('');
  const [check, setCheck] = useState<{ result: SolveResult; rating: DifficultyReport } | null>(
    null,
  );

  const blockCounts = useMemo(
    () => blockCountsByColor(grid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version],
  );

  const balance = useMemo(() => colorBalance(blockCounts, blasters), [blockCounts, blasters]);
  const problems = useMemo(
    () => validateShooters({ blasters, dockColumns }, blockCounts),
    [blasters, dockColumns, blockCounts],
  );

  const byId = useMemo(() => new Map(blasters.map((b) => [b.id, b])), [blasters]);
  const selected = selectedId === null ? undefined : byId.get(selectedId);

  useEffect(() => {
    setIdDraft(selected ? String(selected.id) : '');
    setIdError('');
  }, [selected?.id]);

  useEffect(() => {
    const toolbar = document.querySelector('.toolbar');
    if (!toolbar) return;
    const update = () => setTop(Math.round(toolbar.getBoundingClientRect().bottom) + 8);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(toolbar);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Súng có id nhưng không nằm trong hàng nào — vẫn phải hiện ra, nếu không thì người dùng thấy
  // "thiếu súng" trong danh sách lỗi mà không tìm được nó ở đâu để sửa.
  const orphans = useMemo(() => {
    const placed = new Set(dockColumns.flat());
    return blasters.filter((b) => !placed.has(b.id));
  }, [blasters, dockColumns]);

  const rowOf = (id: number) => dockColumns.findIndex((c) => c.includes(id));

  const totalBullets = blasters.reduce((s, b) => s + b.bulletCount, 0);
  const shootableBlocks = [...blockCounts.entries()]
    .filter(([c]) => c !== WALL_COLOR_ID)
    .reduce((s, [, n]) => s + n, 0);

  /** Màu đang thiếu đạn nhiều nhất — mặc định hợp lý cho súng vừa thêm. */
  const neediestColor = () => {
    const worst = [...balance].sort((a, b) => a.diff - b.diff)[0];
    return worst && worst.diff < 0 ? worst.colorType : (SHOOTABLE_COLORS[0]?.id ?? 1);
  };

  const handleAdd = (row: number) => {
    const color = neediestColor();
    const missing = balance.find((r) => r.colorType === color)?.diff ?? 0;
    // Đạn mặc định = đúng phần còn thiếu của màu đó (chặn ở mục tiêu đạn/súng), để bấm thêm vài lần
    // là vừa khớp thay vì phải tự tính.
    const bullets = missing < 0 ? Math.min(-missing, bulletsPerBlaster) : bulletsPerBlaster;
    setSelectedId(addBlaster(row, color, Math.max(1, bullets)));
  };

  const applyId = (raw: string) => {
    setIdDraft(raw);
    if (!selected) return;
    const n = Number(raw);
    if (!raw.trim() || !Number.isInteger(n) || n <= 0) {
      setIdError('id phải là số nguyên dương');
      return;
    }
    if (n !== selected.id && byId.has(n)) {
      setIdError(`id ${n} đã có súng khác dùng`);
      return;
    }
    if (changeBlasterId(selected.id, n)) {
      setSelectedId(n);
      setIdError('');
    }
  };

  // Sửa bất cứ thứ gì (khối hay súng) là kết quả thử giải cũ hết đúng — xoá ngay, vì một cái dấu
  // "✓ Win được" cũ nằm lại trên panel còn tệ hơn là không có gì.
  useEffect(() => {
    setCheck(null);
  }, [version, blasters, dockColumns, levelMeta.dockCount]);

  const runCheck = () => {
    const input = { grid, blasters, dockColumns, dockCount: levelMeta.dockCount };
    const result = checkWinnable(input);
    setCheck({ result, rating: rateDifficulty(input, result) });
  };

  /** Dời súng đang chọn lên/xuống 1 chỗ trong hàng của nó. */
  const nudge = (delta: number) => {
    if (!selected) return;
    const row = rowOf(selected.id);
    if (row < 0) return;
    const at = dockColumns[row].indexOf(selected.id);
    moveBlaster(selected.id, row, Math.max(0, at + delta));
  };

  const rowCount = dockColumns.length;

  const chip = (id: number, orphan = false) => {
    const b = byId.get(id);
    if (!b) {
      return (
        <span className="bl-chip bl-chip-missing" key={id} title={`id ${id} không có súng nào`}>
          ? {id}
        </span>
      );
    }
    const color = gameColorById(b.color);
    return (
      <button
        className={`bl-chip${b.id === selectedId ? ' active' : ''}${orphan ? ' bl-chip-orphan' : ''}`}
        key={id}
        onClick={() => setSelectedId(b.id)}
        title={`id ${b.id} · ${color?.name ?? b.color} · ${b.bulletCount} đạn · ${
          BLASTER_TYPES.find((t) => t.id === b.type)?.name ?? b.type
        }${orphan ? ' — chưa nằm trong hàng nào' : ''}`}
      >
        <span className="bl-chip-swatch" style={{ background: color?.hex ?? '#000' }} />
        <span className="bl-chip-num">{b.bulletCount}</span>
        {b.type !== 0 && <span className="bl-chip-type">T{b.type}</span>}
      </button>
    );
  };

  // Portal thẳng ra body: panel này render bên trong <Toolbar>, mà .toolbar có backdrop-filter —
  // thứ đó tạo containing block mới cho position:fixed nên panel sẽ bị neo vào khung toolbar.
  return createPortal(
    <div className="bl-dock" style={{ top, maxHeight: `calc(100vh - ${top + 16}px)` }}>
      <div className="bl-dock-head">
        <b>🔫 Blaster</b>
        <span className="bl-dock-sum">
          {blasters.length} súng · {rowCount} hàng
        </span>
        <button className="link-btn legend-collapse" onClick={onClose} title="Đóng">
          ✕
        </button>
      </div>

      <div className="bl-dock-body">
        <div className="bl-dock-sub">
          {totalBullets} đạn / {shootableBlocks} khối bắn được
          {blockCounts.get(WALL_COLOR_ID) ? ` · ${blockCounts.get(WALL_COLOR_ID)} khối tường` : ''}
        </div>

        {/* Cân đối đạn / khối theo màu — bảng quan trọng nhất, để ngay trên đầu. */}
        {balance.length === 0 ? (
          <div className="bl-note">Chưa có khối màu nào trong scene.</div>
        ) : (
          <div className="bl-balance">
            {balance.map((row) => {
              const color = gameColorById(row.colorType);
              return (
                <div
                  className={`bl-bal-row${row.diff === 0 ? ' ok' : row.diff < 0 ? ' short' : ' over'}`}
                  key={row.colorType}
                  title={
                    row.diff === 0
                      ? 'Khớp'
                      : row.diff < 0
                        ? `Thiếu ${-row.diff} đạn`
                        : `Thừa ${row.diff} đạn`
                  }
                >
                  <span className="pal-swatch" style={{ background: color?.hex ?? '#000' }} />
                  <span className="bl-bal-name">{color?.name ?? row.colorType}</span>
                  <span className="bl-bal-num">{row.bullets}</span>
                  <span className="bl-bal-sep">/</span>
                  <span className="bl-bal-num">{row.blocks}</span>
                  <span className="bl-bal-diff">
                    {row.diff === 0 ? '✓' : row.diff > 0 ? `+${row.diff}` : row.diff}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Thử giải + chấm độ khó */}
        <button
          className="bl-check-go"
          disabled={!shootableBlocks}
          onClick={runCheck}
          title="Chơi hộ một lượt để xem có phá hết khối được không, rồi chấm độ khó 0–10"
        >
          🎯 Thử giải &amp; chấm độ khó
        </button>

        {check && (
          <div className={`bl-check${check.result.winnable ? ' ok' : ' bad'}`}>
            <div className="bl-check-head">
              <b>{check.result.winnable ? '✓ Win được' : '✗ Không win được'}</b>
              {check.result.winnable && (
                <span>
                  {check.result.picks} lần bấm · {check.result.totalBlocks} khối
                </span>
              )}
            </div>

            {!check.result.winnable && <div className="bl-check-why">{check.result.reason}</div>}

            {check.result.winnable && (
              <>
                <div className="bl-score">
                  <span className="bl-score-num">{check.rating.score.toFixed(1)}</span>
                  <span className="bl-score-of">/10</span>
                  <span className="bl-score-label">{check.rating.label}</span>
                  <span className="bl-score-enum">
                    → difficulty {check.rating.suggestedDifficulty} (
                    {DIFFICULTY_NAMES[check.rating.suggestedDifficulty]})
                  </span>
                </div>
                <div
                  className={`bl-score-bar${
                    check.rating.score < 4 ? '' : check.rating.score < 7 ? ' mid' : ' hi'
                  }`}
                >
                  <i style={{ width: `${check.rating.score * 10}%` }} />
                </div>

                {/* Từng yếu tố: hiện cả thanh để thấy ngay cái nào đang đẩy điểm lên. Số liệu thật
                    nằm ở tooltip cho đỡ chật. */}
                <div className="bl-factors">
                  {check.rating.factors.map((f) => (
                    <div className="bl-factor" key={f.key} title={`${f.detail} (×${f.weight})`}>
                      <span className="bl-factor-name">{f.label}</span>
                      <span className="bl-factor-bar">
                        <i style={{ width: `${f.value * 100}%` }} />
                      </span>
                    </div>
                  ))}
                </div>

                {check.rating.suggestedDifficulty !== levelMeta.difficulty && (
                  <button
                    className="bl-apply-diff"
                    onClick={() =>
                      setLevelMeta({
                        ...levelMeta,
                        difficulty: check.rating.suggestedDifficulty,
                      })
                    }
                  >
                    Đặt difficulty = {check.rating.suggestedDifficulty} (
                    {DIFFICULTY_NAMES[check.rating.suggestedDifficulty]}), đang là{' '}
                    {levelMeta.difficulty}
                  </button>
                )}
              </>
            )}

            {check.result.ignoredMechanics.length > 0 && (
              <div className="bl-check-approx">
                Chỉ là gần đúng — mô phỏng chưa xử: {check.result.ignoredMechanics.join('; ')}.
              </div>
            )}
          </div>
        )}

        {/* Tạo nhanh */}
        <div className="bl-quick">
          <label className="bl-quick-field">
            <span>Hàng</span>
            <input
              type="number"
              min={1}
              max={20}
              value={rowCount}
              // Bỏ qua giá trị không dùng được thay vì kẹp về 1: xoá trắng ô để gõ lại (raw = '')
              // mà kẹp về 1 hàng là dồn hết súng của mọi hàng vào một chỗ giữa lúc đang gõ.
              onChange={(e) => {
                const n = Number(e.target.value);
                if (e.target.value.trim() && Number.isFinite(n) && n >= 1) setDockRowCount(n);
              }}
            />
          </label>
          <label className="bl-quick-field">
            <span>Đạn/súng</span>
            <input
              type="number"
              min={1}
              value={bulletsPerBlaster}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1) setBulletsPerBlaster(Math.floor(n));
              }}
            />
          </label>
          <button
            className="bl-auto"
            disabled={!shootableBlocks}
            onClick={() => {
              if (
                blasters.length &&
                !confirm(`Tạo lại sẽ thay toàn bộ ${blasters.length} súng đang có. Tiếp tục?`)
              ) {
                return;
              }
              autoBuildShooters(Math.max(1, rowCount), bulletsPerBlaster);
              setSelectedId(null);
            }}
            title="Chia số khối từng màu thành các súng ~ số đạn ở trên, rồi rải đều ra các hàng"
          >
            ⚡ Tạo theo màu khối
          </button>
          <button
            className="bl-icon-btn bl-danger"
            disabled={!blasters.length}
            onClick={() => confirm('Xoá toàn bộ súng?') && (clearShooters(), setSelectedId(null))}
            title="Xoá toàn bộ súng"
          >
            🗑
          </button>
        </div>

        {/* Các hàng chờ: mỗi hàng là một cột dọc, ô trên cùng là đầu hàng. */}
        {rowCount === 0 ? (
          <div className="bl-note">Chưa có hàng nào — đặt “Hàng” ở trên rồi bấm “+”.</div>
        ) : (
          <div className="bl-cols">
            {dockColumns.map((column, row) => {
              const bullets = column.reduce((s, id) => s + (byId.get(id)?.bulletCount ?? 0), 0);
              return (
                <div className="bl-col" key={row}>
                  {/* Số súng/đạn để trên đầu cột: các cột dài ngắn khác nhau nên đặt ở dưới thì
                      những con số này nằm lệch nhau, không so bằng mắt được. */}
                  <div className="bl-col-head" title={`Hàng ${row + 1}`}>
                    <span>H{row + 1}</span>
                    <span className="bl-col-meta" title={`${column.length} súng · ${bullets} đạn`}>
                      {column.length} · {bullets}
                    </span>
                  </div>
                  <div className="bl-col-chips">
                    {column.map((id) => chip(id))}
                    <button
                      className="bl-add"
                      onClick={() => handleAdd(row)}
                      title={`Thêm súng vào hàng ${row + 1}`}
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {orphans.length > 0 && (
          <div className="bl-orphans">
            <div className="bl-orphans-head">Chưa xếp hàng ({orphans.length})</div>
            <div className="bl-orphans-chips">{orphans.map((b) => chip(b.id, true))}</div>
          </div>
        )}

        {/* Sửa 1 súng */}
        {!selected ? (
          <div className="bl-note">Bấm một súng ở trên để sửa, hoặc “+” để thêm mới.</div>
        ) : (
          <div className="bl-edit">
            <div className="bl-edit-grid">
              <label>
                <span>id</span>
                <input
                  type="number"
                  className={idError ? 'bl-bad' : ''}
                  value={idDraft}
                  onChange={(e) => applyId(e.target.value)}
                />
              </label>
              <label>
                <span>Đạn</span>
                <input
                  type="number"
                  min={1}
                  value={selected.bulletCount}
                  onChange={(e) =>
                    updateBlaster(selected.id, { bulletCount: Math.max(0, Number(e.target.value)) })
                  }
                />
              </label>
            </div>
            {idError && <div className="bl-err">{idError}</div>}

            <div className="bl-swatches">
              {SHOOTABLE_COLORS.map((c) => (
                <button
                  key={c.id}
                  className={`swatch${c.id === selected.color ? ' active' : ''}`}
                  style={{ background: c.hex }}
                  title={`${c.id} — ${c.name}`}
                  onClick={() => updateBlaster(selected.id, { color: c.id })}
                />
              ))}
            </div>

            <div className="bl-edit-grid">
              <label>
                <span>type</span>
                <select
                  value={selected.type}
                  onChange={(e) => updateBlaster(selected.id, { type: Number(e.target.value) })}
                >
                  {BLASTER_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} — {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Hàng</span>
                <select
                  value={rowOf(selected.id)}
                  onChange={(e) => moveBlaster(selected.id, Number(e.target.value), -1)}
                >
                  {rowOf(selected.id) < 0 && <option value={-1}>(chưa xếp)</option>}
                  {dockColumns.map((_, i) => (
                    <option key={i} value={i}>
                      Hàng {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="bl-edit-actions">
              <button onClick={() => nudge(-1)} title="Lên một chỗ trong hàng">
                ▲
              </button>
              <button onClick={() => nudge(1)} title="Xuống một chỗ trong hàng">
                ▼
              </button>
              <span className="bl-spacer" />
              <button
                className="bl-danger"
                onClick={() => {
                  removeBlaster(selected.id);
                  setSelectedId(null);
                }}
                title="Xoá súng này"
              >
                🗑 Xoá
              </button>
            </div>

            {selected.type !== 0 && (
              <div className="bl-note">
                Loại {BLASTER_TYPES.find((t) => t.id === selected.type)?.name} được ghi nguyên vào
                file, nhưng tool chưa kiểm luật riêng của nó (khoá/chìa, generator…).
              </div>
            )}
          </div>
        )}

        {/* Chưa có súng nào thì chưa có gì để "sửa" — bảng cân đối ở trên đã nói rõ còn thiếu bao
            nhiêu đạn mỗi màu, nên danh sách lỗi lúc đó chỉ là tiếng ồn. */}
        {problems.length > 0 && blasters.length > 0 && (
          <div className="bl-warn">
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
