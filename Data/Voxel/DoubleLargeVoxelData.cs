using System;
using UnityEngine;

namespace Game.Data
{
    [Serializable]
    public class DoubleLargeVoxelData
    {
        public Bounds bounds;
        public LargeVoxelData group1;
        public LargeVoxelData group2;
    }
}
