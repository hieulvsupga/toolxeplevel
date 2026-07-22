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

## Import ảnh → khối 3D

- Chọn ảnh pixel-art, tool tự dò lưới/bỏ nền, vẽ/xóa từng ô, chọn màu ảnh hoặc bảng màu
- **Độ dày + dáng khối**: extrude theo trục Z với dáng Hộp / Kim tự tháp / Vòm / Bầu dục
  (gọt đối xứng quanh cùng tâm nên mặt vát phẳng, không nhấp nhô) — xem
  [imageVoxelizer.ts](packages/editor/src/lib/imageVoxelizer.ts)
- **Định hình tầng** (thay cho độ dày): mỗi hàng dựng thành mặt cắt ngang Tròn / Vuông /
  Tam giác lấy bề rộng hàng làm đường kính — biến ảnh phẳng thành khối tròn xoay 3D
  (`crossSectionZ` trong imageVoxelizer.ts)
## Lộ trình tiếp theo

- [ ] Import model 3D → voxel (voxelization trong WebWorker)
- [ ] AI gen hình (API hoặc procedural)
- [ ] Tối ưu render lớn (greedy meshing), theo layer, symmetry mirror
```
