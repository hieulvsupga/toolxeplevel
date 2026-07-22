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

## MVP hiện có (xếp tay + snapping)

- Đặt/xóa khối bằng chuột, snap vào lưới, đặt áp mặt (kiểu Minecraft)
- Xem trước vị trí (hover preview), chọn màu khối
- Undo/redo (Ctrl+Z / Ctrl+Y), Clear
- Orbit camera, grid sàn
- Export/Import JSON (`LevelData`)
- **Bảng màu bên phải**: liệt kê màu đang dùng + số block mỗi màu; click để lọc chỉ hiện
  block màu đó (chọn nhiều màu) — [ColorLegend.tsx](packages/editor/src/components/ColorLegend.tsx)

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
