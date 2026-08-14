using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class ShieldData
    {
        public Bounds bounds;
        public int hp;
        public HpTextData[] hpTexts;
        public Vector3Int[] innerVoxelPositions;
    }
}
