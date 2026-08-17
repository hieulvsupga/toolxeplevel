# Voxel Level Tool

Tool xếp level cho game puzzle kiểu voxel (web / HTML5). Monorepo có package
`core` dùng chung giữa **tool xếp level** và **game runtime** — tool export ra
JSON mà game đọc trực tiếp, render giống hệt nhau.

## Cấu trúc

```
packages/
├── core/     Data model dùng chung (framework-agnostic)
│   ├── VoxelGrid      sparse storage Map<"x,y,z", Voxel>
│   ├── serializer     JSON ⇄ VoxelGrid (LevelData schema)
│   └── render         buildInstanceData / createVoxelMesh (three.js)
└── editor/   Web app xếp level (React + react-three-fiber)
    ├── store.ts       state + undo/redo (zustand)
    └── components/    EditorScene, Voxels, Ground, HoverPreview, Toolbar
```

## Chạy

```bash
npm install
npm run dev        # mở http://localhost:5173
```

Build/typecheck: `npm run build`

### Đóng gói app desktop (.exe) cho người khác dùng

```bash
npm run pack -w @voxel/editor
```

Tạo thư mục `packages/editor/release/Voxel Level Tool/` chứa **Voxel Level Tool.exe**
(kèm runtime Electron + bản build). Nén cả thư mục đó gửi cho người khác — họ giải nén
và double-click file `.exe`, không cần cài Node hay gì cả.

Chạy thử bản desktop tại máy dev (không đóng gói): `npm run app -w @voxel/editor`.
Việc này KHÔNG ảnh hưởng `npm run dev` — vẫn test qua localhost như thường.

## MVP hiện có (xếp tay + snapping)

- Đặt/xóa khối bằng chuột, snap vào lưới, đặt áp mặt (kiểu Minecraft)
- Xem trước vị trí (hover preview), chọn màu khối
- Undo/redo (Ctrl+Z / Ctrl+Y), Clear
- Orbit camera, grid sàn (2 trục chính tô màu trục như gizmo)
- **Chọn vùng (`S`)**: kéo ra hộp chọn (Ctrl để đổi chiều cao như lúc đặt), rồi dời cả
  cụm bằng mũi tên / PageUp-Down (giữ Shift: chỉ dời khung), `Ctrl+C/V`, `Ctrl+D` nhân
  bản, `Delete` xóa cụm — mỗi thao tác là 1 lần undo
  ([SelectionPanel.tsx](packages/editor/src/components/SelectionPanel.tsx))
- Export/Import JSON (`LevelData`)
- **Bảng màu bên phải**: liệt kê màu đang dùng + số block mỗi màu; click để lọc chỉ hiện
  block màu đó (chọn nhiều màu) — [ColorLegend.tsx](packages/editor/src/components/ColorLegend.tsx)

## Luật khoang chờ (thứ mọi phép kiểm dựa vào)

Chép ra đây vì đây là phần dễ mô phỏng sai nhất, mà sai thì tool báo "màn ổn" cho một màn
không chơi được — xem [solve.ts](packages/core/src/solve.ts) đầu file:

- Khoang chờ có **tối đa 5 ô** (`MAX_DOCK_COUNT`). Ô nhập `dockCount` bị kẹp ở 5, file .asset nhập
  vào ghi nhiều hơn cũng bị kẹp kèm cảnh báo
- **Thua** = 5 khẩu đã lên khoang mà không khẩu nào khớp khối hở nào (hoặc không rút nổi nhóm nào nữa)
- Súng **hết việc thì biến mất, chừa lại ô trống** — nhưng tính theo ĐƠN VỊ rút, không theo từng khẩu:
  - súng lẻ: cạn đạn là đi ngay
  - **súng hai màu**: phải cạn cả hai túi
  - **cụm nối nhau**: phải MỌI khẩu trong cụm cạn đạn thì cả cụm mới cùng biến mất — khẩu hết đạn
    trước vẫn tiếp tục chiếm ô, chờ bạn nối của nó. Đây là chỗ khiến cụm nối nhau đắt hơn súng lẻ
    rất nhiều
- Nhấc cụm nối nhau là nhấc **cả cụm một lượt**: phải còn đủ ô cho cả cụm (cụm 3 khẩu mà còn 2 ô thì
  không nhấc được), và cụm đông hơn 5 khẩu thì `validateShooters` chặn thẳng vì không bao giờ nhấc được

## Tạo nhanh bộ súng (bảng 🔫 Blaster)

Nút **⚡ Tạo theo màu khối…** mở popup ([AutoBuildDialog.tsx](packages/editor/src/components/AutoBuildDialog.tsx)):

- **Độ khó theo thang 1–10** (đúng thang mà `rateDifficulty` chấm, không phải enum 3 mức của
  Unity): kéo thang là bật sẵn bộ cơ chế của mức đó và đặt khoảng random số lượng. Enum
  `LevelDifficulty` của level được suy ra qua `levelDifficultyForScore` — cùng ngưỡng với nút
  “Thử giải” nên hai chỗ không bao giờ lệch nhau
- **Dò tới đúng điểm** (`autoBuildSearch`): sinh 18 phương án (bớt / giữ / nhồi thêm cơ chế × 3
  cách xếp màu vào hàng), chạy `checkWinnable` + `rateDifficulty` cho từng cái rồi giữ cái gần mục
  tiêu nhất, **loại thẳng phương án không giải được**. Nhờ vậy tường, số màu, số lớp phải bóc, khối
  lượng màn đều được tính vào — chứ suy từ số cơ chế thì màn nhiều tường luôn khó hơn mức đặt. Kẹt
  thang thì nói rõ phần thiếu nằm ở hình khối. ~450ms cho màn 500 khối; màn >3000 voxel bớt hệ số
  (~1s), >6000 bớt nữa
- **Cách xếp màu trong hàng là đòn bẩy mạnh nhất**, vì khoang chờ chỉ có 5 ô: `mixed` (rải vòng
  tròn = dễ nhất), `grouped` (mỗi hàng dồn một màu), `sameHeads` (đầu mọi hàng cùng màu = khoang dễ
  bị nhồi toàn một màu). Đo trên màn giếng tường phân tầng theo màu (chỉ tầng trên hở): cùng một bộ
  cơ chế mà `mixed` và `sameHeads` ra màn **không giải được**, còn `grouped` thì giải được — nên
  vòng dò bằng mô phỏng là thứ duy nhất chọn đúng được, đoán theo mức điểm là ra màn hỏng
- `rateDifficulty` được bổ sung 3 yếu tố có trọng số riêng: **Ice 1.5 / Lock 1.5 / Connected 1**
  (tính theo tỉ lệ trên số khẩu). Trước đó 4 cơ chế đã-mô-phỏng-được này không có trọng số nào —
  chúng chỉ hiện ra rất nhẹ qua số lần chờ, nên nhồi kín băng/khoá vẫn bị chấm gần như màn trống.
  Tổng trọng số 16 → 20, tức **điểm của các màn cũ sẽ thấp hơn trước một chút** nếu màn đó không
  dùng mấy cơ chế này
- Bảng mở dần theo điểm: 🧊 Ice từ 2, ❓ Hidden từ 3, 🔗 Connected từ 4, 🔒 Lock từ 6,
  🎨 Double từ 7; điểm 10 thì Ice/Hidden 5, Connected/Lock/Double 3
- **Cơ chế**: Connected / Ice / Lock+Key / Double / Hidden, mỗi cái bật-tắt riêng và có ô số —
  để trống là tool tự random, gõ số là đúng số đó (Ice = 2 thì đúng 2 khẩu băng)
- Số đạn LUÔN chia khớp đúng số khối từng màu (điều kiện thắng), kể cả khi có súng hai màu:
  Double được dựng bằng cách **gộp 2 khẩu khác màu** rồi đẩy phần dư sang khẩu cùng màu khác,
  vì khẩu hai màu tính đủ `bulletCount` cho cả hai màu
- Cơ chế được đặt sao cho không rơi vào thế bí mà `validateShooters` chặn: luôn chừa đầu một hàng
  không băng/không khoá, chìa nằm ở hàng khác với ổ, không giấu màu khẩu đứng đầu hàng, cặp nối
  luôn cùng bậc ở hai hàng khác nhau
- Dựng thiếu (bàn không đủ khẩu hợp lệ) thì báo rõ thiếu bao nhiêu thay vì im lặng
- Logic nằm trong core: [autoBuild.ts](packages/core/src/autoBuild.ts)

## Import ảnh → khối 3D

- Chọn ảnh pixel-art, tool tự dò lưới/bỏ nền, vẽ/xóa từng ô, chọn màu ảnh hoặc bảng màu
- **Độ dày + dáng khối**: extrude theo trục Z với dáng Hộp / Kim tự tháp / Vòm / Bầu dục
  (gọt đối xứng quanh cùng tâm nên mặt vát phẳng, không nhấp nhô) — xem
  [imageVoxelizer.ts](packages/editor/src/lib/imageVoxelizer.ts)
- **Định hình tầng** (thay cho độ dày): mỗi hàng dựng thành mặt cắt ngang Tròn / Vuông
  lấy bề rộng hàng làm đường kính — biến ảnh phẳng thành khối tròn xoay 3D
  (`crossSectionZRange` trong imageVoxelizer.ts). Đổ màu: **Theo ảnh** (mặc định, tô
  theo cột) hoặc **Bọc 4 mặt** (mặt trước/sau tô theo X, trái/phải theo Z → nhìn từ 4
  hướng chính đều thấy ảnh gốc)
## Import model 3D → khối

- Nạp `.fbx .glb .gltf .obj .stl`, voxel hóa đặc (solid) bằng ray-casting theo cột —
  xem [modelVoxelizer.ts](packages/editor/src/lib/modelVoxelizer.ts)
- **Xem trước 3D trực tiếp** trong panel (r3f + OrbitControls), voxel hóa lại theo thời
  gian thực khi đổi độ phân giải / màu / texture
- Chọn độ phân giải (số ô theo cạnh dài nhất)
- Màu: **theo model** (vật liệu), **theo texture** (nạp ảnh texture → lấy màu theo UV mặt
  cắt, cần model có UV), hoặc **1 màu**
- Cần model **kín mặt** để lấp trong đúng; model Z-up có thể bị nằm ngang (xoay nguồn trước)

## Lộ trình tiếp theo

- [ ] AI gen hình (API hoặc procedural)
- [ ] Voxel hóa trong WebWorker (model nặng khỏi đơ UI), tuỳ chọn trục Up
- [ ] Tối ưu render lớn (greedy meshing), theo layer, symmetry mirror
```
