using System;
using UnityEngine;

namespace Game.Data
{
    // A colorType of ColorType.None marks a permanent, non-target obstacle voxel ("wall") —
    // it never becomes a shooting target and is excluded from the level clear-condition.
    [Serializable]
    public class LayerData
    {
        public int depth;
        public ColorType colorType;
        public Vector3Int[] voxelPositions;
    }
}
