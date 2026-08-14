using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class PlaypenData
    {
        public Bounds bounds;
        public ColorType[] screwColors;
        public int hp;
        public HpTextData[] hpTexts;
        public Vector3Int[] innerVoxelPositions;
    }
}
