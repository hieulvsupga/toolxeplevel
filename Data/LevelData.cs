using System;
using System.Collections.Generic;
using UnityEngine;

namespace Game.Data
{
    // Unity's serializer cannot persist a nested generic container (List<List<int>>) to a
    // ScriptableObject asset — it silently drops the field with no error at save time. This
    // wrapper is the one extra level of indirection Unity needs to serialize a list of lists.
    [Serializable]
    public class DockColumnData
    {
        public List<int> blasterIds = new();
    }

    [CreateAssetMenu(fileName = "Level", menuName = "Game/Level Data")]
    public class LevelData : ScriptableObject
    {
        public int levelVersion;
        public int dockCount;
        public LevelDifficulty difficulty;
        public bool shouldLoop;
        public bool shouldOfferMeteorShower;

        public Vector3 rootPosition;
        public Vector3 rootLocalEulerAngles;
        public Vector3 voxelizedObjectCenterPosition;
        public Vector3 voxelizedObjectShadowPosition;
        public float voxelizedObjectScale;

        public LayerData[] layers;

        // V1-relevant
        public IceWrapperData[] iceWrapperData;

        // Extensibility placeholders — not acted on by V1 gameplay code
        public LargeVoxelData[] largeVoxelData;
        public DoubleLargeVoxelData[] doubleLargeVoxelData;
        public GiftWrapperData[] giftWrapperData;
        public PlaypenData[] playpenData;
        public ShrinkingCoverData[] shrinkingCoverData;
        public BombData[] bombData;
        public ColorBoxData[] colorBoxData;
        public ShieldData[] shieldData;
        public FlyingPiggyData[] flyingPiggyData;

        // Flat pool of every shooter in the level, referenced by BlasterData.id.
        public List<BlasterData> blasters = new();

        // Queue columns, each a list of blaster ids in order.
        public List<DockColumnData> dockColumns = new();

        /// <summary>
        /// Resolves every BlasterData's connected/chained/inner id lists into direct object
        /// references. Call once after loading the asset; gameplay code should never need to
        /// look up a blaster by id after this runs.
        /// </summary>
        public void ResolveReferences()
        {
            var byId = new Dictionary<int, BlasterData>(blasters.Count);
            foreach (var blaster in blasters)
            {
                byId[blaster.id] = blaster;
            }

            foreach (var blaster in blasters)
            {
                blaster.ConnectedBlasters = ResolveIds(blaster.connectedBlasterIds, byId);
                blaster.ChainedBlasters = ResolveIds(blaster.chainedBlasterIds, byId);
                blaster.InnerBlasters = ResolveIds(blaster.innerBlasterIds, byId);
            }
        }

        private static List<BlasterData> ResolveIds(List<int> ids, Dictionary<int, BlasterData> byId)
        {
            var result = new List<BlasterData>(ids.Count);
            foreach (var id in ids)
            {
                if (byId.TryGetValue(id, out var blaster))
                {
                    result.Add(blaster);
                }
            }
            return result;
        }
    }
}
