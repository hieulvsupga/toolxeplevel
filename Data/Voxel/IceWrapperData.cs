using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class IceWrapperData
    {
        public Bounds bounds;
        public int hp;
        public HpTextData[] hpTexts;
        public Vector3Int[] innerVoxelPositions;
    }
}
