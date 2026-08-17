import {
  EMPTY_SHOOTERS,
  decodeIntList,
  encodeIntList,
  makeBlaster,
  type BlasterEntry,
  type ShooterSetup,
} from './blasters';
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
  // Khối dựng thẳng, nhìn chính diện (x=90 là mức dựng đứng hoàn toàn — xem RootRotationPreview).
  // Các level mẫu trong DataExample dùng 65/0/45 (ngả ra xa 25°, xoay chéo 45°), nhưng mặc định của
  // tool lấy góc chính diện để khối vừa dựng ra là nhìn đúng mặt trước.
  rootLocalEulerAngles: { x: 90, y: 0, z: 0 },
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
 * Ghi phần khối (`layers`) và phần shooter (`blasters` + `dockColumns`); các mảng cơ chế còn lại để
 * rỗng — Unity đọc lên là mảng rỗng, không phải null, nên gameplay code duyệt chúng vẫn an toàn.
 *
 * Không sinh kèm file `.meta`: thả .asset vào project là Unity tự tạo .meta với GUID mới, an toàn
 * hơn tự đặt GUID rồi lỡ trùng với một asset sẵn có.
 */
export function toUnityAsset(
  layers: LevelLayer[],
  meta: LevelMeta,
  shooters: ShooterSetup = EMPTY_SHOOTERS,
): string {
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
  );

  if (shooters.blasters.length === 0) {
    lines.push('  blasters: []');
  } else {
    lines.push('  blasters:');
    for (const b of shooters.blasters) {
      lines.push(
        `  - id: ${num(b.id)}`,
        `    sourceId: ${num(b.sourceId)}`,
        `    type: ${num(b.type)}`,
        `    color: ${num(b.color)}`,
        `    secondaryColor: ${num(b.secondaryColor)}`,
        `    bulletCount: ${num(b.bulletCount)}`,
        `    isHidden: ${b.isHidden ? 1 : 0}`,
        `    iceHp: ${num(b.iceHp)}`,
        `    isPilot: ${b.isPilot ? 1 : 0}`,
        `    isChained: ${b.isChained ? 1 : 0}`,
        // Dấu cách sau dấu hai chấm là cách Unity ghi List<int> rỗng — giữ đúng để diff với file
        // Unity ghi lại là rỗng.
        `    connectedBlasterIds: ${encodeIntList(b.connectedBlasterIds)}`,
        `    chainedBlasterIds: ${encodeIntList(b.chainedBlasterIds)}`,
        `    innerBlasterIds: ${encodeIntList(b.innerBlasterIds)}`,
      );
    }
  }

  if (shooters.dockColumns.length === 0) {
    lines.push('  dockColumns: []');
  } else {
    lines.push('  dockColumns:');
    for (const column of shooters.dockColumns) {
      lines.push(`  - blasterIds: ${encodeIntList(column)}`);
    }
  }

  lines.push('');

  return lines.join('\n');
}

export interface ParsedLevelAsset {
  meta: LevelMeta;
  layers: LevelLayer[];
  shooters: ShooterSetup;
  /** Chuyện đáng ngờ nhưng không chặn được việc đọc file — hiện cho người dùng xem. */
  warnings: string[];
}

/** Một dòng `    key: value` bên trong một phần tử của `blasters` -> field tương ứng. */
function readBlasterField(blaster: BlasterEntry, key: string, raw: string): void {
  switch (key) {
    case 'sourceId':
    case 'type':
    case 'color':
    case 'secondaryColor':
    case 'bulletCount':
    case 'iceHp':
      blaster[key] = Number(raw);
      return;
    case 'isHidden':
    case 'isPilot':
    case 'isChained':
      blaster[key] = raw !== '0';
      return;
    case 'connectedBlasterIds':
    case 'chainedBlasterIds':
    case 'innerBlasterIds':
      blaster[key] = decodeIntList(raw);
      return;
  }
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
 * Các mảng cơ chế (ice/bomb/playpen…) bị bỏ qua — tool chưa dựng được chúng, và đọc vào rồi ghi ra
 * thành mảng rỗng thì tệ hơn là nói thẳng ra rằng chúng không được giữ.
 */
export function parseUnityAsset(text: string): ParsedLevelAsset {
  const lines = text.split(/\r?\n/);
  const warnings: string[] = [];
  const meta: LevelMeta = { ...DEFAULT_LEVEL_META };
  const layers: LevelLayer[] = [];
  const blasters: BlasterEntry[] = [];
  const dockColumns: number[][] = [];

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
  let blaster: BlasterEntry | undefined;
  let inBlasters = false;
  let inDock = false;

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

    if (inBlasters) {
      if (/^  \S/.test(line) && !/^  - /.test(line)) {
        inBlasters = false;
        blaster = undefined;
      } else {
        const id = /^  - id:\s*(-?\d+)/.exec(line);
        if (id) {
          blaster = makeBlaster({ id: Number(id[1]) });
          blasters.push(blaster);
          continue;
        }
        const field = /^    (\w+):\s*(.*)$/.exec(line);
        if (field && blaster) readBlasterField(blaster, field[1], field[2].trim());
        continue;
      }
    }

    if (inDock) {
      if (/^  \S/.test(line) && !/^  - /.test(line)) {
        inDock = false;
      } else {
        const ids = /^  - blasterIds:\s*(\S*)\s*$/.exec(line);
        if (ids) dockColumns.push(decodeIntList(ids[1]));
        continue;
      }
    }

    if (/^  layers:\s*$/.test(line)) {
      inLayers = true;
      continue;
    }
    if (/^  blasters:\s*$/.test(line)) {
      inBlasters = true;
      continue;
    }
    if (/^  dockColumns:\s*$/.test(line)) {
      inDock = true;
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
  ].filter((key) => lines.some((l) => l.startsWith(`  ${key}:`) && !l.endsWith('[]')));
  if (dropped.length) {
    warnings.push(`Không đọc (và sẽ mất nếu xuất đè): ${dropped.join(', ')}.`);
  }

  // Các loại súng ngoài Normal đọc/ghi được nguyên vẹn nhưng bảng blaster của tool chưa dựng được
  // luật của chúng — nói ra để người dựng level đừng tưởng đã kiểm hết.
  const specialTypes = [...new Set(blasters.filter((b) => b.type !== 0).map((b) => b.type))];
  if (specialTypes.length) {
    warnings.push(
      `Có súng loại đặc biệt (type ${specialTypes.join(', ')}) — giữ nguyên khi xuất, nhưng tool ` +
        `chỉ kiểm được luật của loại Normal.`,
    );
  }

  return { meta, layers, shooters: { blasters, dockColumns }, warnings };
}
