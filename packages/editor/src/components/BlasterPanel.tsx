import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BLASTER_TYPES,
  BLASTER_TYPE_KEY,
  BLASTER_TYPE_LOCK,
  BLASTER_TYPE_NORMAL,
  GAME_COLORS,
  WALL_COLOR_ID,
  blockCountsByColor,
  checkWinnable,
  colorBalance,
  dockPositionOf,
  gameColorById,
  rateDifficulty,
  type DifficultyReport,
  type SolveResult,
} from '@voxel/core';
import { useEditor } from '../store';
import { AutoBuildDialog } from './AutoBuildDialog';

interface BlasterPanelProps {
  onClose: () => void;
}

/**
 * Cả bảng màu game trừ ô tường (tường không bao giờ là mục tiêu nên không súng nào bắn nó).
 *
 * Đây chỉ là NGUỒN để lọc, không phải thứ bày ra: các ô chọn màu của súng chỉ hiện màu đang có
 * khối trên hình — xem `gridColors` trong panel.
 */
const SHOOTABLE_COLORS = GAME_COLORS.filter((c) => c.id !== WALL_COLOR_ID);

const DIFFICULTY_NAMES = ['Normal', 'Hard', 'VeryHard'];

/**
 * Thanh mechanic. Mỗi mechanic là một chế độ bấm riêng trên các chip súng.
 *
 * Để dạng mảng để thêm cơ chế sau chỉ là thêm một dòng — nhưng chỉ liệt kê thứ tool dựng được thật.
 * Nút xám cho cơ chế chưa làm thì chỉ là chỗ để bấm vào rồi không có gì xảy ra.
 */
const MECHANICS = [
  {
    id: 'connected' as const,
    label: '🔗 Connected',
    hint: 'Bấm 2 khẩu để nối chúng vào nhau (bấm lại cặp đã nối là bỏ nối). Cả cụm lên khoang chờ cùng một lượt nên phải còn đủ ô trống cho cả cụm, và chỉ biến mất khi MỌI khẩu trong cụm bắn xong — khẩu hết đạn trước vẫn tiếp tục chiếm ô.',
  },
  {
    id: 'ice' as const,
    label: '🧊 Ice',
    hint: 'Bấm một khẩu để bọc băng (bấm lại là gỡ). Khẩu bọc băng không bấm lên được; mỗi lượt nhấc một khẩu bất kỳ thì băng của mọi khẩu tan 1.',
  },
  {
    id: 'lock' as const,
    label: '🔒 Lock',
    hint: 'Bấm một khẩu để biến nó thành ổ khoá (bấm lại là bỏ). Ổ khoá chưa mở thì không bấm được, và mọi khẩu xếp sau nó trong hàng cũng kẹt theo.',
  },
  {
    id: 'key' as const,
    label: '🔑 Key',
    hint: 'Bấm một khẩu để gắn chìa (bấm lại là bỏ). Chìa lên khoang chờ là mở một ổ khoá — nhớ xếp chìa ở hàng KHÔNG bị chính ổ đó chặn.',
  },
  {
    id: 'double' as const,
    label: '🎨 Double',
    hint: 'Chọn màu 2 rồi bấm một khẩu để nó thành súng hai màu (bấm lại là bỏ). Mỗi màu có túi đạn riêng bằng bulletCount, và phải bắn hết màu 1 mới sang màu 2.',
  },
  {
    id: 'hidden' as const,
    label: '❓ Hidden',
    hint: 'Bấm một khẩu để giấu màu (bấm lại là bỏ giấu). Khẩu giấu màu chỉ lộ màu thật khi khẩu ngay trước nó được nhấc lên — nên đừng giấu khẩu đang đứng đầu hàng, nó chẳng còn ai phía trước để lộ.',
  },
];

type MechanicId = (typeof MECHANICS)[number]['id'];

/** Một đoạn nối vẽ giữa 2 chip, toạ độ tính theo khung chứa các hàng. */
interface LinkLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Cặp có dính tới súng đang chọn — vẽ đậm hơn. */
  hot: boolean;
}

/**
 * Bảng xếp blaster, neo ở góc trên bên phải scene (không phải popup — để vừa xếp súng vừa xoay
 * khối mà nhìn được cả hai).
 *
 * Thân bảng chia HAI KHUNG cạnh nhau, mỗi khung tự cuộn: bên trái là lưới hàng chờ, bên phải là
 * cân đối đạn / thử giải / mechanic / tạo nhanh / sửa khẩu đang chọn. Xếp dọc một cột như trước thì
 * lưới bị đẩy xuống giữa, mà lưới lại là thứ phải nhìn liên tục — sửa một khẩu là phải cuộn ngược
 * lên tìm lại nó.
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
  const clearShooters = useEditor((s) => s.clearShooters);
  const toggleBlasterConnection = useEditor((s) => s.toggleBlasterConnection);
  const levelMeta = useEditor((s) => s.levelMeta);
  const setLevelMeta = useEditor((s) => s.setLevelMeta);
  const wrapperCount = useEditor((s) => s.wrappers.length);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [bulletsPerBlaster, setBulletsPerBlaster] = useState(40);
  const [autoOpen, setAutoOpen] = useState(false);
  /** Tóm tắt lần tạo nhanh gần nhất — để biết tool đã random ra những gì. */
  const [autoSummary, setAutoSummary] = useState<{ text: string; notes: string[] } | null>(null);
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
  /** Mechanic đang bật trên thanh mechanic; null = bấm chip là chọn súng như thường. */
  const [mechanic, setMechanic] = useState<MechanicId | null>(null);
  /** Khẩu đã bấm đầu tiên, đang chờ bấm khẩu thứ hai để nối. */
  const [pendingLink, setPendingLink] = useState<number | null>(null);
  /** Số băng gán cho khẩu khi bấm bằng mechanic Ice. */
  const [iceAmount, setIceAmount] = useState(5);
  /** Lưới ô màu 2 đang mở hay không (ô sửa khẩu). */
  const [secondOpen, setSecondOpen] = useState(false);
  /** Màu 2 gán cho khẩu khi bấm bằng mechanic Double. */
  const [secondColor, setSecondColor] = useState(SHOOTABLE_COLORS[0]?.id ?? 1);

  // Vẽ đoạn nối: cần vị trí thật của từng chip nên phải đo sau khi layout xong.
  const linksBoxRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<number, HTMLElement>());
  const [linkLines, setLinkLines] = useState<LinkLine[]>([]);

  const blockCounts = useMemo(
    () => blockCountsByColor(grid),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, version],
  );

  const balance = useMemo(() => colorBalance(blockCounts, blasters), [blockCounts, blasters]);

  /**
   * Màu bày ra ở các ô chọn màu của súng: chỉ những màu ĐANG CÓ khối trên hình (trừ tường).
   *
   * Bày cả 16 màu của game thì hầu hết là màu màn này không dùng, mà bấm nhầm một ô là ra khẩu súng
   * bắn màu chẳng có khối nào — tổng đạn lệch nhưng nhìn dãy ô màu không thấy gì sai, phải mở bảng
   * cân bằng mới lòi ra.
   */
  const gridColors = useMemo(
    () => SHOOTABLE_COLORS.filter((c) => (blockCounts.get(c.id) ?? 0) > 0),
    [blockCounts],
  );

  /**
   * Như trên nhưng giữ thêm mấy màu đang được dùng dù hình không còn khối màu đó (level nhập từ
   * .asset, hoặc vừa xoá hết khối màu ấy). Bỏ đi thì ô đang chọn biến mất khỏi lưới, nhìn như khẩu
   * súng không có màu nào — và không bấm lại được vào chính màu nó đang mang.
   */
  const colorsWith = (...keep: number[]) => {
    const ids = new Set(gridColors.map((c) => c.id));
    for (const id of keep) if (id !== WALL_COLOR_ID) ids.add(id);
    return SHOOTABLE_COLORS.filter((c) => ids.has(c.id));
  };

  /** Màu không còn khối nào — ô của nó phải nói rõ, không thì nhìn y hệt màu dùng được. */
  const goneNote = (id: number) => ((blockCounts.get(id) ?? 0) > 0 ? '' : ' (hình không còn khối màu này)');

  const byId = useMemo(() => new Map(blasters.map((b) => [b.id, b])), [blasters]);
  const selected = selectedId === null ? undefined : byId.get(selectedId);

  useEffect(() => {
    setIdDraft(selected ? String(selected.id) : '');
    setIdError('');
    // Đổi sang khẩu khác thì gập lưới màu lại, không thì nó mở lơ lửng cho một khẩu khác.
    setSecondOpen(false);
  }, [selected?.id]);

  // Hình đổi (xoá hết khối một màu, nhập level khác) mà màu 2 đang chọn không còn khối nào thì kéo
  // nó về màu đầu tiên đang có. Chỉ chạy khi `gridColors` đổi, nên màu do người dùng tự bấm — kể cả
  // màu không còn khối — vẫn được giữ nguyên.
  useEffect(() => {
    if (!gridColors.length) return;
    if (gridColors.some((c) => c.id === secondColor)) return;
    setSecondColor(gridColors[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridColors]);

  /** Các súng đang nối với súng đang chọn — để tô sáng cho thấy cặp. */
  const partnerIds = useMemo(
    () => new Set(selected?.connectedBlasterIds ?? []),
    [selected?.connectedBlasterIds],
  );


  /**
   * Đo vị trí các chip rồi dựng danh sách đoạn nối.
   *
   * Toạ độ lấy hiệu của hai `getBoundingClientRect` (chip trừ khung chứa) nên đã trừ sẵn phần cuộn —
   * lớp SVG nằm trong đúng khung đó và cuộn cùng nội dung, không cần bắt sự kiện scroll.
   */
  useLayoutEffect(() => {
    const box = linksBoxRef.current;
    if (!box) {
      setLinkLines([]);
      return;
    }
    const measure = () => {
      const base = box.getBoundingClientRect();
      const seen = new Set<string>();
      const lines: LinkLine[] = [];
      for (const blaster of blasters) {
        for (const other of blaster.connectedBlasterIds) {
          const key = blaster.id < other ? `${blaster.id}-${other}` : `${other}-${blaster.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const from = chipRefs.current.get(blaster.id);
          const to = chipRefs.current.get(other);
          if (!from || !to) continue; // một đầu chưa xếp vào hàng -> không có gì để nối trên hình
          const a = from.getBoundingClientRect();
          const b = to.getBoundingClientRect();
          lines.push({
            key,
            x1: a.left - base.left + a.width / 2,
            y1: a.top - base.top + a.height / 2,
            x2: b.left - base.left + b.width / 2,
            y2: b.top - base.top + b.height / 2,
            hot: selectedId === blaster.id || selectedId === other,
          });
        }
      }
      setLinkLines(lines);
    };
    measure();
    // Panel co giãn / thêm bớt hàng đều làm chip xê dịch, mà những thứ đó không phải lúc nào cũng
    // đi kèm một lần render của component này.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [blasters, dockColumns, selectedId]);

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
    if (worst && worst.diff < 0) return worst.colorType;
    // Không màu nào thiếu đạn -> lấy màu đầu tiên ĐANG CÓ trên hình, để khẩu vừa thêm không mang
    // một màu chẳng có khối nào.
    return gridColors[0]?.id ?? SHOOTABLE_COLORS[0]?.id ?? 1;
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
    const linked = partnerIds.has(b.id);
    const linking = mechanic === 'connected';
    const pending = pendingLink === b.id;
    const pickable = linking && pendingLink !== null && !pending;
    const alreadyLinked =
      pickable && (byId.get(pendingLink!)?.connectedBlasterIds.includes(b.id) ?? false);
    return (
      <button
        ref={(el) => {
          if (el) chipRefs.current.set(b.id, el);
          else chipRefs.current.delete(b.id);
        }}
        className={
          `bl-chip${b.id === selectedId ? ' active' : ''}` +
          `${orphan ? ' bl-chip-orphan' : ''}${linked ? ' bl-chip-linked' : ''}` +
          `${pending ? ' bl-chip-pending' : ''}${pickable ? ' bl-chip-pickable' : ''}` +
          `${b.iceHp > 0 ? ' bl-chip-iced' : ''}` +
          `${mechanic && mechanic !== 'connected' ? ' bl-chip-pickable' : ''}`
        }
        key={id}
        onClick={() => {
          if (mechanic === 'ice') {
            updateBlaster(b.id, { iceHp: b.iceHp > 0 ? 0 : iceAmount });
            setSelectedId(b.id);
            return;
          }
          if (mechanic === 'hidden') {
            updateBlaster(b.id, { isHidden: !b.isHidden });
            setSelectedId(b.id);
            return;
          }
          if (mechanic === 'double') {
            // Bấm lại đúng màu đang gán = bỏ hai màu. Màu 2 trùng màu 1 thì vô nghĩa nên chặn.
            const next = b.secondaryColor === secondColor || secondColor === b.color ? 0 : secondColor;
            updateBlaster(b.id, { secondaryColor: next });
            setSelectedId(b.id);
            return;
          }
          if (mechanic === 'lock' || mechanic === 'key') {
            const want = mechanic === 'lock' ? BLASTER_TYPE_LOCK : BLASTER_TYPE_KEY;
            updateBlaster(b.id, { type: b.type === want ? BLASTER_TYPE_NORMAL : want });
            setSelectedId(b.id);
            return;
          }
          if (linking) {
            // Bấm 1: chọn khẩu đầu. Bấm 2: nối / bỏ nối. Bấm lại đúng khẩu đầu: huỷ.
            if (pendingLink === null) {
              setPendingLink(b.id);
              setSelectedId(b.id);
              return;
            }
            if (pending) {
              setPendingLink(null);
              return;
            }
            toggleBlasterConnection(pendingLink, b.id);
            setPendingLink(null);
            return;
          }
          setSelectedId(b.id);
        }}
        title={
          mechanic === 'hidden'
            ? b.isHidden
              ? `Bỏ giấu màu cho ${b.id}`
              : `Giấu màu ${b.id}`
            : mechanic === 'ice'
            ? b.iceHp > 0
              ? `Gỡ băng khỏi ${b.id} (đang ${b.iceHp})`
              : `Bọc băng ${iceAmount} cho ${b.id}`
            : pickable
            ? `${alreadyLinked ? 'Bỏ nối' : 'Nối'} ${pendingLink} ↔ ${b.id}`
            : pending
              ? `${b.id} — bấm khẩu thứ hai để nối, hoặc bấm lại để huỷ`
              : `id ${b.id} · ${color?.name ?? b.color} · ${b.bulletCount} đạn · ${
                  BLASTER_TYPES.find((t) => t.id === b.type)?.name ?? b.type
                }${
                  b.secondaryColor !== WALL_COLOR_ID
                    ? ` → rồi ${gameColorById(b.secondaryColor)?.name ?? b.secondaryColor} (${b.bulletCount} đạn mỗi màu)`
                    : ''
                }${b.isHidden ? ' · giấu màu' : ''}${b.iceHp > 0 ? ` · băng ${b.iceHp}` : ''}${
                  b.connectedBlasterIds.length ? ` · nối với ${b.connectedBlasterIds.join(', ')}` : ''
                }${
                  orphan ? ' — chưa nằm trong hàng nào' : ''
                }`
        }
      >
        {/* Vẫn hiện màu THẬT (đây là công cụ dựng level, người dựng phải thấy), chỉ phủ thêm vân
            gạch để biết trong game màu này đang bị giấu — đỡ tốn chỗ hơn một huy hiệu riêng. */}
        {/* backgroundColor chứ KHÔNG phải background: viết tắt `background` sẽ xoá luôn
            `background-image` trong CSS, tức mất sạch vân gạch của khẩu giấu màu. */}
        <span
          className={`bl-chip-swatch${b.isHidden ? ' bl-swatch-hidden' : ''}`}
          style={{ backgroundColor: color?.hex ?? '#000' }}
        />
        {/* Súng hai màu: ô màu thứ hai dán sát ngay sau ô thứ nhất, đọc được luôn thứ tự bắn
            (trái = bắn trước). Rõ hơn một huy hiệu chữ, mà cũng chỉ tốn 8px. */}
        {b.secondaryColor !== WALL_COLOR_ID && (
          <span
            className="bl-chip-swatch2"
            style={{ backgroundColor: gameColorById(b.secondaryColor)?.hex ?? '#000' }}
          />
        )}
        <span className="bl-chip-num">{b.bulletCount}</span>
        {b.iceHp > 0 && <span className="bl-chip-ice">🧊{b.iceHp}</span>}
        {b.connectedBlasterIds.length > 0 && <span className="bl-chip-link">🔗</span>}
        {/* Ổ khoá / chìa hiện hẳn biểu tượng — hai loại này quyết định thứ tự bấm nên phải thấy
            ngay trên chip, không thể để người dùng đoán từ "T1"/"T2". */}
        {b.type === BLASTER_TYPE_LOCK && <span className="bl-chip-type">🔒</span>}
        {b.type === BLASTER_TYPE_KEY && <span className="bl-chip-type">🔑</span>}
        {b.type !== BLASTER_TYPE_NORMAL &&
          b.type !== BLASTER_TYPE_LOCK &&
          b.type !== BLASTER_TYPE_KEY && <span className="bl-chip-type">T{b.type}</span>}
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
        {/* Khung trái: chỉ lưới hàng chờ. Tách hẳn khỏi phần điều khiển vì đây là thứ phải
            nhìn liên tục trong lúc xếp — để chung một cột dọc thì mỗi lần sửa một khẩu lại
            phải cuộn ngược lên tìm nó. */}
        <div className="bl-pane bl-pane-grid">
          {/* Các hàng chờ: mỗi hàng là một cột dọc, ô trên cùng là đầu hàng. */}
          {rowCount === 0 ? (
            <div className="bl-note">Chưa có hàng nào — đặt “Hàng” ở trên rồi bấm “+”.</div>
          ) : (
            <div className="bl-cols">
              <div className="bl-cols-inner" ref={linksBoxRef}>
                {/* Đoạn nối vẽ dưới các chip (SVG đứng trước nên chip che lên), nên trông như dây
                    chạy từ mép khẩu này sang mép khẩu kia. */}
                <svg className="bl-link-lines">
                  {linkLines.map((l) => (
                    <line
                      key={l.key}
                      x1={l.x1}
                      y1={l.y1}
                      x2={l.x2}
                      y2={l.y2}
                      className={l.hot ? 'hot' : undefined}
                    />
                  ))}
                </svg>
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
            </div>
          )}

          {orphans.length > 0 && (
            <div className="bl-orphans">
              <div className="bl-orphans-head">Chưa xếp hàng ({orphans.length})</div>
              <div className="bl-orphans-chips">{orphans.map((b) => chip(b.id, true))}</div>
            </div>
          )}
        </div>

        {/* Khung phải: cân đối đạn, thử giải, mechanic, tạo nhanh, sửa khẩu đang chọn. */}
        <div className="bl-pane bl-pane-side">
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

          {/* Thanh mechanic: bật một cơ chế lên rồi bấm thẳng vào các chip súng bên dưới. */}
          <div className="bl-mech">
            <span className="bl-mech-label">Mechanic</span>
            {MECHANICS.map((m) => (
              <button
                key={m.id}
                className={`bl-mech-btn${mechanic === m.id ? ' active' : ''}`}
                // Bật/tắt mechanic thì bỏ luôn khẩu đang chờ. Xoá ở đây chứ không trong một effect
                // theo `mechanic`: nút "+ nối" bên dưới bật mechanic KÈM một khẩu chờ sẵn, effect sẽ
                // xoá mất khẩu đó ngay lần render sau.
                onClick={() => {
                  setMechanic((cur) => (cur === m.id ? null : m.id));
                  setPendingLink(null);
                }}
                title={m.hint}
              >
                {m.label}
              </button>
            ))}
            {mechanic && (
              <button
                className="bl-mech-off"
                onClick={() => {
                  setMechanic(null);
                  setPendingLink(null);
                }}
                title="Tắt mechanic"
              >
                ✕
              </button>
            )}
          </div>
          {mechanic && (
            <div className="bl-note bl-linking-hint">
              {mechanic === 'ice' && (
                <label className="bl-ice-amount">
                  Băng
                  <input
                    type="number"
                    min={1}
                    value={iceAmount}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n) && n >= 1) setIceAmount(Math.floor(n));
                    }}
                  />
                </label>
              )}
              {mechanic === 'double' && (
                <span className="bl-ice-amount">
                  Màu 2
                  <span className="bl-mini-swatches">
                    {colorsWith(secondColor).map((c) => (
                      <button
                        key={c.id}
                        className={`swatch${c.id === secondColor ? ' active' : ''}${
                          goneNote(c.id) ? ' gone' : ''
                        }`}
                        style={{ background: c.hex }}
                        title={`${c.id} — ${c.name}${goneNote(c.id)}`}
                        onClick={() => setSecondColor(c.id)}
                      />
                    ))}
                    {!gridColors.length && <span className="bl-no-color">hình chưa có khối màu nào</span>}
                  </span>
                </span>
              )}
              {mechanic === 'connected' && pendingLink !== null
                ? `Đã chọn ${pendingLink} — bấm khẩu thứ hai để nối (bấm lại ${pendingLink} để huỷ).`
                : MECHANICS.find((m) => m.id === mechanic)?.hint}
            </div>
          )}

          {check && (
            <div className={`bl-check${check.result.winnable ? ' ok' : ' bad'}`}>
              <div className="bl-check-head">
                <b>{check.result.winnable ? '✓ Win được' : '✗ Không win được'}</b>
                {check.result.winnable && (
                  <span>
                    {check.result.picks} lần bấm · {check.result.totalBlocks} khối
                  </span>
                )}
                <button
                  className="bl-check-close"
                  onClick={() => setCheck(null)}
                  title="Đóng kết quả (bấm Thử giải để chạy lại)"
                >
                  ✕
                </button>
              </div>

              {!check.result.winnable && <div className="bl-check-why">{check.result.reason}</div>}

              {/* Phép mô phỏng chưa biết luật lớp bọc (chưa phá vỏ thì chưa bắn được khối trong),
                  nên nói thẳng ra thay vì để người dựng tin vào một điểm khó sai. */}
              {wrapperCount > 0 && (
                <div className="bl-check-why">
                  Level có {wrapperCount} lớp bọc 🧊 — phép thử này CHƯA tính luật lớp bọc (coi như
                  khối bên trong bắn được ngay), nên màn thật sẽ khó hơn con số ở đây.
                </div>
              )}

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

              {/* Giấu màu không đổi được kết quả giải, nhưng người chơi thật thì mò chứ không nhìn
                  thấy như mô phỏng — phải nói rõ kẻo con số bị đọc thành "màn này dễ". */}
              {check.result.hiddenCount > 0 && (
                <div className="bl-check-approx">
                  {check.result.hiddenCount} khẩu giấu màu — lời giải này chơi với thông tin đầy đủ,
                  nên đây là giới hạn trên; người chơi không nhìn trước được màu.
                </div>
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
              onClick={() => setAutoOpen(true)}
              title="Mở bảng tạo nhanh: chọn độ khó, cơ chế và số lượng từng cơ chế"
            >
              ⚡ Tạo theo màu khối…
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

          {autoSummary && (
            <div className="bl-note">
              {autoSummary.text}
              {autoSummary.notes.map((n) => (
                <div className="bl-note-warn" key={n}>
                  {n}
                </div>
              ))}
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

              {/* Chỉ các màu ĐANG CÓ trên hình (cộng thêm màu khẩu này đang mang, nếu hình không
                  còn khối màu đó nữa) — xem `gridColors`. */}
              <div className="bl-swatches">
                {colorsWith(selected.color, selected.secondaryColor).map((c) => (
                  <button
                    key={c.id}
                    className={`swatch${c.id === selected.color ? ' active' : ''}${
                      goneNote(c.id) ? ' gone' : ''
                    }`}
                    style={{ background: c.hex }}
                    title={`Màu 1 (bắn trước): ${c.id} — ${c.name}${goneNote(c.id)}`}
                    // Đổi màu 1 thành đúng màu 2 thì bỏ luôn màu 2: súng hai màu mà hai màu giống
                    // nhau là data vô nghĩa (mô phỏng cũng bỏ qua túi đạn thứ hai).
                    onClick={() =>
                      updateBlaster(selected.id, {
                        color: c.id,
                        ...(c.id === selected.secondaryColor
                          ? { secondaryColor: WALL_COLOR_ID }
                          : null),
                      })
                    }
                  />
                ))}
              </div>

              <div className="bl-edit-grid">
                {/* Màu 2 (súng Double): một ô chọn gập/mở như `type`/`Hàng`, nhưng mở ra LƯỚI Ô MÀU
                    chứ không phải danh sách tên màu — chọn màu thì phải nhìn màu. Dãy 17 ô phẳng
                    kiểu cũ thì quá bé để thấy đang chọn ô nào, mà lại nằm sát dãy màu 1 nên rất dễ
                    bấm nhầm. Ô màu trên nút cho biết ngay khẩu này có màu 2 hay không; màu đang là
                    màu 1 bị gạch chéo vì súng hai màu cùng màu là vô nghĩa. */}
                <div className="bl-edit-second">
                  <span>🎨 Màu 2 (bắn sau)</span>
                  <button
                    className={`bl-second-btn${secondOpen ? ' open' : ''}`}
                    onClick={() => setSecondOpen((o) => !o)}
                    title="Màu thứ hai của súng Double — bắn sau khi hết màu 1"
                  >
                    <span
                      className={`bl-second-dot${selected.secondaryColor === WALL_COLOR_ID ? ' off' : ''}`}
                      style={
                        selected.secondaryColor === WALL_COLOR_ID
                          ? undefined
                          : { background: gameColorById(selected.secondaryColor)?.hex }
                      }
                    />
                    <span className="bl-second-name">
                      {selected.secondaryColor === WALL_COLOR_ID
                        ? 'không dùng (1 màu)'
                        : `${selected.secondaryColor} — ${gameColorById(selected.secondaryColor)?.name}`}
                    </span>
                    <span className="bl-second-caret">▾</span>
                  </button>
                  {secondOpen && (
                    <div className="bl-second-list">
                      <button
                        className={`bl-second-none${selected.secondaryColor === WALL_COLOR_ID ? ' active' : ''}`}
                        onClick={() => {
                          updateBlaster(selected.id, { secondaryColor: WALL_COLOR_ID });
                          setSecondOpen(false);
                        }}
                      >
                        ✕ không dùng — súng một màu
                      </button>
                      <div className="bl-second-grid">
                        {colorsWith(selected.color, selected.secondaryColor).map((c) => (
                          <button
                            key={c.id}
                            className={`bl-second-sw${c.id === selected.secondaryColor ? ' active' : ''}${
                              goneNote(c.id) ? ' gone' : ''
                            }`}
                            style={{ background: c.hex }}
                            disabled={c.id === selected.color}
                            title={
                              c.id === selected.color
                                ? `${c.id} — ${c.name} (đang là màu 1, không chọn được)`
                                : `${c.id} — ${c.name}${goneNote(c.id)}`
                            }
                            onClick={() => {
                              updateBlaster(selected.id, { secondaryColor: c.id });
                              setSecondOpen(false);
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
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
                <label>
                  <span>🧊 iceHp</span>
                  <input
                    type="number"
                    min={0}
                    value={selected.iceHp}
                    onChange={(e) =>
                      updateBlaster(selected.id, { iceHp: Math.max(0, Number(e.target.value)) })
                    }
                  />
                </label>
                <label className="bl-edit-check">
                  <input
                    type="checkbox"
                    checked={selected.isHidden}
                    onChange={(e) => updateBlaster(selected.id, { isHidden: e.target.checked })}
                  />
                  ❓ isHidden
                </label>
              </div>

              {/* Cơ chế Connected: nối 2 súng, quan hệ luôn hai chiều. */}
              <div className="bl-links">
                <span className="bl-links-head">🔗 Nối với</span>
                {selected.connectedBlasterIds.length === 0 && (
                  <span className="bl-links-none">chưa nối</span>
                )}
                {selected.connectedBlasterIds.map((pid) => {
                  const partner = byId.get(pid);
                  const pos = dockPositionOf(dockColumns, pid);
                  return (
                    <button
                      className={`bl-link-chip${partner ? '' : ' bl-chip-missing'}`}
                      key={pid}
                      onClick={() => toggleBlasterConnection(selected.id, pid)}
                      title={
                        partner
                          ? `Bỏ nối với ${pid}${pos ? ` (hàng ${pos[0] + 1}, bậc ${pos[1] + 1})` : ''}`
                          : `id ${pid} không có súng nào — bấm để bỏ nối`
                      }
                    >
                      {partner && (
                        <span
                          className="bl-chip-swatch"
                          style={{ background: gameColorById(partner.color)?.hex ?? '#000' }}
                        />
                      )}
                      {pid} ✕
                    </button>
                  );
                })}
                {/* Chỗ này chỉ để XEM và BỎ nối. Tạo nối thì đi qua thanh mechanic ở trên — hai lối
                    cùng làm một việc chỉ khiến người dùng phải đoán nên dùng lối nào. */}
                <button
                  className={`bl-add${mechanic === 'connected' ? ' active' : ''}`}
                  onClick={() => {
                    setMechanic('connected');
                    setPendingLink(selected.id);
                  }}
                  title="Bật mechanic Connected và chọn sẵn khẩu này, rồi bấm khẩu thứ hai"
                >
                  + nối
                </button>
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

              {/* Key/Lock giờ đã được mô phỏng, chỉ còn các loại khác là chưa — đừng để dòng nhắc cũ
                  nói oan là tool không kiểm khoá/chìa. */}
              {selected.type !== BLASTER_TYPE_NORMAL &&
                selected.type !== BLASTER_TYPE_KEY &&
                selected.type !== BLASTER_TYPE_LOCK && (
                  <div className="bl-note">
                    Loại {BLASTER_TYPES.find((t) => t.id === selected.type)?.name} được ghi nguyên vào
                    file, nhưng tool chưa kiểm luật riêng của nó (generator, búa…).
                  </div>
                )}
            </div>
          )}

          {/* Panel này không còn hộp lỗi / hộp lưu ý nào. Bảng "Đạn so với khối" ở trên vẫn tô đỏ màu
              nào thiếu đạn, và nút Thử giải vẫn nói rõ vì sao không win được — hai chỗ đó đủ để thấy
              vấn đề. `validateShooters()` / `connectionWarnings()` vẫn nằm trong core (bảng Xuất
              .asset còn dùng), nên bật lại chỗ này lúc nào cũng được. */}
        </div>
      </div>

      {autoOpen && (
        <AutoBuildDialog
          defaultRowCount={rowCount || 3}
          defaultBullets={bulletsPerBlaster}
          // Mở ở đúng điểm mà lần Thử giải gần nhất chấm được (nếu có) — chỉnh từ mức thật
          // của màn dễ hơn là đoán lại từ đầu.
          defaultScore={check ? Math.round(check.rating.score) : 5}
          shootableBlocks={shootableBlocks}
          onClose={() => setAutoOpen(false)}
          onDone={(text, notes) => {
            setAutoSummary({ text, notes });
            setSelectedId(null);
          }}
        />
      )}
    </div>,
    document.body,
  );
}
