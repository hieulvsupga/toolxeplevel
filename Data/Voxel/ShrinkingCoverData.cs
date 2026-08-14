using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class ShrinkingCoverData
    {
        public Bounds bounds;
        public Vector3 position;
        public ColorType colorType;
        public int hp;
        public HpTextData[] hpTexts;
        public Vector3Int[] innerVoxelPositions;
    }
}
