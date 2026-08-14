using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class ColorBoxData
    {
        public Bounds bounds;
        public ColorType colorType;
        public int hp;
        public HpTextData[] hpTexts;
        public Vector3Int[] innerVoxelPositions;
    }
}
