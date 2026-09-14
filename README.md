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

## Hướng dẫn sử dụng

Trong tool: nút **❔ Hướng dẫn** trên toolbar, hoặc phím **F1** (`?` cũng được). Bảng đó có mục lục
bên trái, nội dung bên phải và ô lọc theo từ khoá — gồm 14 mục: từ dựng khối, chọn vùng, camera, bảng
màu/tường, tô tầng, nhập ảnh-model, xếp súng, **luật khoang chờ**, tạo súng tự động, xuất/nhập
`.asset`, xử lý sự cố, tới bảng tổng hợp phím tắt.

Nội dung nằm ở [guideContent.ts](packages/editor/src/components/guideContent.ts) dưới dạng **dữ liệu**
(`GuideSection[]` với các block `p` / `ul` / `steps` / `keys` / `note`), còn
[GuidePanel.tsx](packages/editor/src/components/GuidePanel.tsx) chỉ lo dựng hình — thêm mục thì sửa
đúng một file, mục lục và phần lọc tự có theo. Sửa tính năng thì nhớ sửa mục tương ứng ở đó.

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

## Chọn hướng khối cho game (bảng Xuất .asset)

Cột phải của bảng Xuất là khung xem trước 3D
([RootRotationPreview.tsx](packages/editor/src/components/RootRotationPreview.tsx)): **camera đứng
yên, KHỐI quay** — đúng như trong game, nơi chỉ transform gốc của level mang
`rootLocalEulerAngles`. Kéo chuột trong khung là sửa thẳng ba góc đó (ngang = xoay quanh trục đứng
của khối, dọc = ngả trước/sau, Shift + ngang = góc Y).

Quy đổi góc Unity sang three.js không thể nhét thẳng ba số, vì Unity thuận trái (Z hướng vào trong)
và quay theo thứ tự Z→X→Y. Qua phép soi gương `M: (x,y,z) → (x,y,−z)`:

```
ma trận Unity = RY(y)·RX(x)·RZ(z)   (quay thuận trái = quay thuận phải với góc đổi dấu)
M·(…)·M       = RY(+y)·RX(+x)·RZ(−z)  theo chiều thuận phải  =  THREE.Euler(x, y, −z, 'YXZ')
```

Vị trí khối cũng phải soi gương theo (z đổi dấu), không thì hình bị lộn so với game. Tự kiểm bằng số:
`(0,0,0)` → khối nằm ngửa (trục đứng chỉ vào màn hình); `(90,0,0)` → dựng thẳng, nhìn chính diện —
**đây là góc mặc định của tool**; `(65,0,45)` → dựng đứng, ngả ra xa 25°, xoay chéo 45° (góc các level
mẫu trong DataExample dùng).

**Camera game** (đo từ Transform camera trong Unity): `position (0, 0, -10)`, `rotation (0, 0, 0)` —
nhìn thẳng dọc +Z, KHÔNG nghiêng. Soi gương z thì thành camera three.js ở `(0, 0, +10)` nhìn dọc −Z,
đúng hướng mặc định, nên preview cùng hướng nhìn với game.

Khung preview thì **lùi xa hơn camera game và dùng fov 30° thay vì 60°**, có chủ ý: việc ở đây là căn
hướng, nên phải thấy trọn khối và thấy đúng hình dáng (fov rộng làm méo phối cảnh, cạnh gần phình ra).
Khoảng cách tính từ bán kính khối quanh gốc quay nên **cỡ hình không đổi khi xoay** — có vậy mới so
được góc nào đẹp hơn. `rootPosition` và `objectScale` cố tình không áp vào: chúng chỉ dịch/phóng khối
trong scene game chứ không đổi hướng, áp vào là khối lệch khỏi khung.

## Dịch level của tapaway sang LevelData

```bash
npm run convert:tapaway          # ca 1745 file
npm run convert:tapaway -- 20    # chi 20 file dau, de thu
```

Vào `levelgametapaway/levelbase/level_*.txt` → ra `voxellevel/level_*.asset`. Logic ở
[scripts/convert-tapaway.ts](scripts/convert-tapaway.ts), format đọc ra từ `LevelManager.cs` của tapaway:

- **dòng 0** `sz|sx|sy|<ô>|<ô>|…` — số ĐẦU là kích thước trục Z, rồi X, rồi Y (chính `Edittext()` bên
  họ cũng đảo lại). Thứ tự ô là y-major → x → z (z trong cùng), theo ba vòng lặp của `CreateMap()`
- **dòng 1** `rotX|rotY|rotZ|cameraDistance[|limitMove]` — cách tapaway trình bày khối, không mang sang
- **dòng 2** `style|style|…` song song 1:1 với danh sách ô (đã kiểm: khớp ở cả 1745 file)
- **dòng 3** khối ghép x2/x3 — chỉ 13/1745 file có, và nó chỉ GỘP khối đã có ở dòng 0 thành khối dài
  chứ không thêm ô mới, nên bỏ qua được mà hình khối vẫn đủ

Quy đổi:

| tapaway | tool này |
|---|---|
| ô `> 0` (số = hướng trượt 1..6) | một khối; hướng bỏ đi vì game mình không có cơ chế đó |
| ô `-2` tường | ô tường (`ColorType 0`) — trùng nghĩa hoàn toàn |
| ô `-3` grinder | cũng thành tường (nó cũng là vật cản), script đếm riêng và báo |
| `styleColor` 1..15 | `ColorType` 1..15 — cả hai đều là "số nhóm", map thẳng số sang số |
| trục Y lên (Unity) | trục Z lên |

Trục phải **đảo chiều sâu** (`our.y = sz - 1 - g`): phép đổi cơ sở `(X,Y,Z) → (X,Z,Y)` làm lật
chirality, không đảo thì khối ra ảnh gương. Đảo chiều sâu chứ không đảo trái–phải, để nhìn từ mặt trước
(hướng camera mặc định của tool) là thấy đúng hình gốc.

Mỗi file ra kèm **bộ súng cơ bản** (`autoShooters`, 5 hàng, ~40 đạn/khẩu) nên tổng đạn khớp đúng số khối
từng màu — file là data hợp lệ ngay. Muốn có cơ chế và mức khó thì mở tool bấm **⚡ Tạo theo màu khối…**.

Đã kiểm: đọc lại cả 1745 file `.asset` bằng đúng đường mà tool nhập file (`parseUnityAsset` →
`gridFromLayers`) rồi so với data gốc — **1745/1745 khớp** cả hình dạng, số khối và số ô tường.

## Bảng liệt kê level (.xlsx) cho người dựng map

```bash
npm run report:levels
```

Ra `voxellevel/danh-sach-level.xlsx` — 1745 dòng, 13 cột, hàng tiêu đề **khoá sẵn** và **bật lọc/sắp
xếp**, số ghi dạng số thật nên lọc theo khoảng (ví dụ "số khối từ 200 đến 350") chạy đúng.

| cột | nghĩa |
|---|---|
| STT, Level | số thứ tự và tên file `.asset` |
| Số khối / Số tường / Số màu | khối bắn được, ô tường, số `ColorType` đang dùng |
| Rộng (X) / Sâu (Y) / Cao (Z) | hộp bao **thật** của khối, không phải cỡ lưới trong file gốc |
| Số layer | số layer trong `LevelData` (mỗi layer = một cặp depth + màu) |
| Số lớp depth | số lớp phải bóc từ vỏ vào lõi |
| Khối hở sẵn / Khối bị chôn / % bị chôn | depth 0 là bắn được ngay; phần còn lại phải đào mới tới |

Hai cột cuối là thứ đáng nhìn khi chọn hình khối: **% bị chôn càng cao thì màn càng khó**, vì khoang
chờ chỉ có 5 ô nên súng của màu đang bị chôn lên khoang sớm là ngồi chiếm chỗ.

Số liệu đọc từ chính file `.asset` (qua `parseUnityAsset`, đúng đường mà tool nhập file) nên bảng mô tả
đúng thứ người dựng sẽ mở ra. Đối chiếu chéo với data gốc của tapaway: `level_100` 173 khối/5 màu,
`level_315` 443 khối/86 tường, `level_321` 27 tường + 24 grinder = 51 — khớp.

Bộ ghi `.xlsx` viết tay trong [scripts/miniXlsx.ts](scripts/miniXlsx.ts) (ZIP + vài file XML, ~200 dòng)
thay vì thêm dependency. Không chọn CSV vì Excel trên máy Việt Nam lấy `;` làm dấu phân cách — file CSV
dấu phẩy mở ra là dồn hết vào một cột và số bị đọc thành chữ.

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
