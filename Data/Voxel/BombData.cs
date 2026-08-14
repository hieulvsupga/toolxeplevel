using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class BombData
    {
        public Bounds bounds;
        public ColorType colorType;
        public int hp;
        public Vector3Int[] innerVoxelPositions;
    }
}
