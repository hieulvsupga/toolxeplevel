using System;
using System.Collections.Generic;
using UnityEngine;

namespace Game.Data
{
    // A single global color palette shared by every level (mirrors Cube Land's
    // VoxelColorData/BlasterColorData design, rather than Voxel Flow's per-level palette).
    [CreateAssetMenu(fileName = "ColorPalette", menuName = "Game/Color Palette")]
    public class ColorPaletteData : ScriptableObject
    {
        [Serializable]
        public class ColorEntry
        {
            public ColorType colorType;

            // Must stay in sync with what the atlas cell at atlasIndex actually looks like: voxels
            // sample their color straight from the atlas, while shooters tint a flat material with
            // THIS value. In a game whose whole mechanic is matching colors, a drift between the
            // two would make a shooter and its matching voxels read as different colors — a
            // functional bug, not a cosmetic one.
            public Color color;

            // Which cell of the block atlas this color lives in (0-based, counted from the
            // BOTTOM-left cell going right then up — that's the origin the shader's _Index math
            // uses, since UV space starts bottom-left).
            public int atlasIndex;
        }

        public ColorEntry[] colorEntries;

        private Dictionary<ColorType, ColorEntry> _lookup;

        public Color GetColor(ColorType colorType) =>
            TryGet(colorType, out var entry) ? entry.color : Color.magenta;

        /// <summary>
        /// Atlas cell for <paramref name="colorType"/>, or -1 if it has no entry.
        /// </summary>
        public int GetAtlasIndex(ColorType colorType) =>
            TryGet(colorType, out var entry) ? entry.atlasIndex : -1;

        // ColorType.None deliberately has no entry: it's a sentinel, never a renderable color. A
        // lookup for it falls through to magenta / -1 on purpose — anything that ends up asking to
        // draw "None" is misconfigured, and should look obviously broken rather than quietly
        // neutral.
        private bool TryGet(ColorType colorType, out ColorEntry entry)
        {
            if (_lookup == null)
            {
                _lookup = new Dictionary<ColorType, ColorEntry>(colorEntries.Length);
                foreach (var candidate in colorEntries)
                {
                    _lookup[candidate.colorType] = candidate;
                }
            }
            return _lookup.TryGetValue(colorType, out entry);
        }
    }
}
