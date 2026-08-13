import type { LevelLayer } from './layers';
import type { Vec3 } from './types';

/**
 * GUID của `Assets/_Project/Scripts/Data/LevelData.cs` (đọc từ LevelData.cs.meta). Đây là thứ
 * duy nhất nối file .asset mình xuất ra với class `LevelData`; sai GUID thì Unity load asset lên
 * thành script missing chứ không báo lỗi gì rõ ràng.
 */
export const LEVEL_DATA_SCRIPT_GUID = 'bfb17734dfa3b1141aae8e00b43e6d11';

/** Các trường cấp level nằm ngoài phần khối. Mặc định lấy theo các file mẫu trong DataExample. */
export interface LevelMeta {
  name: string;
  levelVersion: number;
  dockCount: number;
  /** `LevelDifficulty`: 0 Normal, 1 Hard, 2 VeryHard. */
  difficulty: number;
  shouldLoop: boolean;
  shouldOfferMeteorShower: boolean;
  rootPosition: Vec3;
  rootLocalEulerAngles: Vec3;
  voxelizedObjectCenterPosition: Vec3;
  voxelizedObjectShadowPosition: Vec3;
  voxelizedObjectScale: number;
}

export const DEFAULT_LEVEL_META: LevelMeta = {
  name: 'Level',
  levelVersion: 1,
  dockCount: 5,
  difficulty: 0,
  shouldLoop: false,
  shouldOfferMeteorShower: true,
  rootPosition: { x: 0, y: -5, z: 2.5 },
  rootLocalEulerAngles: { x: 65, y: 0, z: 45 },
  voxelizedObjectCenterPosition: { x: 0, y: 0, z: 0 },
  voxelizedObjectShadowPosition: { x: -0.02, y: -12.5, z: 4 },
  voxelizedObjectScale: 1,
};

// Unity ghi số thực dạng thập phân thuần, không bao giờ dùng ký hiệu mũ. Số nhỏ như 1e-7 mà lọt
// vào file sẽ làm YAML parser của Unity bỏ nguyên field đó.
function num(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
}

function vec3(v: Vec3): string {
  return `{x: ${num(v.x)}, y: ${num(v.y)}, z: ${num(v.z)}}`;
}

/**
 * Sinh nội dung file `.asset` (YAML của Unity) cho một `LevelData`.
 *
 * Chỉ ghi phần khối (`layers`); mọi mảng cơ chế và danh sách shooter đều để rỗng — Unity đọc lên
 * là mảng rỗng, không phải null, nên gameplay code duyệt chúng vẫn an toàn.
 *
 * Không sinh kèm file `.meta`: thả .asset vào project là Unity tự tạo .meta với GUID mới, an toàn
 * hơn tự đặt GUID rồi lỡ trùng với một asset sẵn có.
 */
export function toUnityAsset(layers: LevelLayer[], meta: LevelMeta): string {
  const lines: string[] = [
    '%YAML 1.1',
    '%TAG !u! tag:unity3d.com,2011:',
    '--- !u!114 &11400000',
    'MonoBehaviour:',
    '  m_ObjectHideFlags: 0',
    '  m_CorrespondingSourceObject: {fileID: 0}',
    '  m_PrefabInstance: {fileID: 0}',
    '  m_PrefabAsset: {fileID: 0}',
    '  m_GameObject: {fileID: 0}',
    '  m_Enabled: 1',
    '  m_EditorHideFlags: 0',
    `  m_Script: {fileID: 11500000, guid: ${LEVEL_DATA_SCRIPT_GUID}, type: 3}`,
    `  m_Name: ${meta.name}`,
    '  m_EditorClassIdentifier: Assembly-CSharp::Game.Data.LevelData',
    `  levelVersion: ${num(meta.levelVersion)}`,
    `  dockCount: ${num(meta.dockCount)}`,
    `  difficulty: ${num(meta.difficulty)}`,
    `  shouldLoop: ${meta.shouldLoop ? 1 : 0}`,
    `  shouldOfferMeteorShower: ${meta.shouldOfferMeteorShower ? 1 : 0}`,
    `  rootPosition: ${vec3(meta.rootPosition)}`,
    `  rootLocalEulerAngles: ${vec3(meta.rootLocalEulerAngles)}`,
    `  voxelizedObjectCenterPosition: ${vec3(meta.voxelizedObjectCenterPosition)}`,
    `  voxelizedObjectShadowPosition: ${vec3(meta.voxelizedObjectShadowPosition)}`,
    `  voxelizedObjectScale: ${num(meta.voxelizedObjectScale)}`,
  ];

  if (layers.length === 0) {
    lines.push('  layers: []');
  } else {
    lines.push('  layers:');
    for (const layer of layers) {
      lines.push(`  - depth: ${num(layer.depth)}`);
      lines.push(`    colorType: ${num(layer.colorType)}`);
      if (layer.voxelPositions.length === 0) {
        lines.push('    voxelPositions: []');
        continue;
      }
      lines.push('    voxelPositions:');
      for (const p of layer.voxelPositions) {
        lines.push(`    - ${vec3(p)}`);
      }
    }
  }

  // Thứ tự các field dưới đây bám đúng thứ tự khai báo trong LevelData.cs — Unity ghi asset theo
  // thứ tự field, nên giữ nguyên thì diff giữa file mình xuất và file Unity ghi lại sau khi mở là
  // rỗng, thay vì đầy những dòng chỉ đổi chỗ.
  lines.push(
    '  iceWrapperData: []',
    '  largeVoxelData: []',
    '  doubleLargeVoxelData: []',
    '  giftWrapperData: []',
    '  playpenData: []',
    '  shrinkingCoverData: []',
    '  bombData: []',
    '  colorBoxData: []',
    '  shieldData: []',
    '  flyingPiggyData: []',
    '  blasters: []',
    '  dockColumns: []',
    '',
  );

  return lines.join('\n');
}

export interface ParsedLevelAsset {
  meta: LevelMeta;
  layers: LevelLayer[];
  /** Chuyện đáng ngờ nhưng không chặn được việc đọc file — hiện cho người dùng xem. */
  warnings: string[];
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?`;
const VEC3_RE = new RegExp(
  String.raw`\{\s*x:\s*(${NUMBER})\s*,\s*y:\s*(${NUMBER})\s*,\s*z:\s*(${NUMBER})\s*\}`,
);

/**
 * Đọc ngược file `.asset` của Unity về `LevelData`.
 *
 * Cố tình quét theo dòng thay vì nạp một thư viện YAML: file Unity ghi ra luôn có đúng một dạng
 * thụt lề và các trường mình cần đều là scalar hoặc Vector3 một dòng, nên bám sát dạng đó vừa gọn
 * vừa không kéo thêm phụ thuộc chỉ để đọc vài chục dòng.
 *
 * Các mảng cơ chế (ice/bomb/playpen…) và blaster/dock bị bỏ qua — tool chưa dựng được chúng, và
 * đọc vào rồi ghi ra thành mảng rỗng thì tệ hơn là nói thẳng ra rằng chúng không được giữ.
 */
export function parseUnityAsset(text: string): ParsedLevelAsset {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];
  const meta: LevelMeta = { ...DEFAULT_LEVEL_META };
  const layers: LevelLayer[] = [];

  const scriptLine = lines.find((l) => l.includes('m_Script:'));
  if (!scriptLine) {
    throw new Error('Không phải file .asset của Unity (thiếu dòng m_Script).');
  }
  const guid = /guid:\s*([0-9a-f]{32})/.exec(scriptLine)?.[1];
  if (guid !== LEVEL_DATA_SCRIPT_GUID) {
    throw new Error(
      `File này gắn với script GUID ${guid ?? '(không đọc được)'}, không phải LevelData ` +
        `(${LEVEL_DATA_SCRIPT_GUID}). Có thể là một ScriptableObject khác.`,
    );
  }

  const scalar = (line: string, key: string): string | undefined => {
    const m = new RegExp(String.raw`^  ${key}:\s*(.*)$`).exec(line);
    return m ? m[1].trim() : undefined;
  };
  const readVec3 = (raw: string): Vec3 | undefined => {
    const m = VEC3_RE.exec(raw);
    return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : undefined;
  };

  let layer: LevelLayer | undefined;
  let inLayers = false;

  for (const line of lines) {
    if (inLayers) {
      // Bất kỳ field cấp trên nào cũng kết thúc mảng layers (field kế tiếp là iceWrapperData).
      if (/^  \S/.test(line) && !/^  - /.test(line)) {
        inLayers = false;
        layer = undefined;
      } else {
        const depth = /^  - depth:\s*(-?\d+)/.exec(line);
        if (depth) {
          layer = { depth: Number(depth[1]), colorType: 0, voxelPositions: [] };
          layers.push(layer);
          continue;
        }
        const colorType = /^    colorType:\s*(-?\d+)/.exec(line);
        if (colorType && layer) {
          layer.colorType = Number(colorType[1]);
          continue;
        }
        if (/^    - \{/.test(line) && layer) {
          const pos = readVec3(line);
          if (pos) layer.voxelPositions.push(pos);
          continue;
        }
        continue;
      }
    }

    if (/^  layers:\s*$/.test(line)) {
      inLayers = true;
      continue;
    }

    const name = scalar(line, 'm_Name');
    if (name !== undefined) {
      meta.name = name;
      continue;
    }
    for (const key of ['levelVersion', 'dockCount', 'difficulty'] as const) {
      const raw = scalar(line, key);
      if (raw !== undefined) meta[key] = Number(raw);
    }
    for (const key of ['shouldLoop', 'shouldOfferMeteorShower'] as const) {
      const raw = scalar(line, key);
      if (raw !== undefined) meta[key] = raw !== '0';
    }
    const scale = scalar(line, 'voxelizedObjectScale');
    if (scale !== undefined) meta.voxelizedObjectScale = Number(scale);
    for (const key of [
      'rootPosition',
      'rootLocalEulerAngles',
      'voxelizedObjectCenterPosition',
      'voxelizedObjectShadowPosition',
    ] as const) {
      const raw = scalar(line, key);
      if (raw === undefined) continue;
      const vec = readVec3(raw);
      if (vec) meta[key] = vec;
    }
  }

  if (!layers.length) warnings.push('File không có layer nào — level rỗng.');

  // Các mảng cơ chế được ghi kèm nhưng tool chưa dựng được. Nói ra ngay lúc nhập, vì nếu xuất đè
  // lên chính file này thì chúng biến mất không dấu vết.
  const dropped = [
    'iceWrapperData',
    'largeVoxelData',
    'doubleLargeVoxelData',
    'giftWrapperData',
    'playpenData',
    'shrinkingCoverData',
    'bombData',
    'colorBoxData',
    'shieldData',
    'flyingPiggyData',
    'blasters',
  ].filter((key) => lines.some((l) => l.startsWith(`  ${key}:`) && !l.endsWith('[]')));
  if (dropped.length) {
    warnings.push(`Không đọc (và sẽ mất nếu xuất đè): ${dropped.join(', ')}.`);
  }

  return { meta, layers, warnings };
}
