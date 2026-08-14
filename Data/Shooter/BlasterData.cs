using System;
using System.Collections.Generic;

namespace Game.Data
{
    [Serializable]
    public class BlasterData
    {
        public int id;
        public int sourceId;

        public BlasterType type;
        public ColorType color;
        public ColorType secondaryColor;
        public int bulletCount;
        public bool isHidden;
        public int iceHp;
        public bool isPilot;
        public bool isChained;

        public List<int> connectedBlasterIds = new();
        public List<int> chainedBlasterIds = new();
        public List<int> innerBlasterIds = new();

        // Resolved once by LevelData.ResolveReferences() right after load — gameplay code
        // reads these directly, no repeated id lookups.
        [NonSerialized] public List<BlasterData> ConnectedBlasters;
        [NonSerialized] public List<BlasterData> ChainedBlasters;
        [NonSerialized] public List<BlasterData> InnerBlasters;
    }
}
