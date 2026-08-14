using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class GiftWrapperData
    {
        public Bounds bounds;
        public HpTextData[] hpTexts;
        public Vector3Int[] innerVoxelPositions;
    }
}
