namespace Game.Data
{
    // The colors THIS game can actually render — one per cell of the block texture atlas, not the
    // 21-color space Cube Land's source levels are authored in. Those source ids live only inside
    // the importer (see SourceColorMapper), which folds each one onto its nearest match here at
    // import time; nothing downstream of the importer ever sees a source id.
    //
    // Values run 1..16 in atlas-cell order, so enum value == atlasIndex + 1 and the two are easy to
    // eyeball against each other. That correspondence is a convenience, NOT something to rely on:
    // the real cell index is declared per-entry in ColorPaletteData, so re-arranging the atlas only
    // means editing that asset, never renumbering this enum.
    //
    // None stays 0 and is never a renderable color — it's the sentinel for a Wall voxel (GDD 4.6)
    // and for "this shooter has no secondary color" (Double, GDD 4.5), and it's what
    // default(ColorType) has to be for both of those to keep working.
    public enum ColorType
    {
        None = 0,
        Magenta = 1,
        Red = 2,
        Yellow = 3,
        White = 4,
        Orange = 5,
        Pink = 6,
        Purple = 7,
        Lilac = 8,
        Blue = 9,
        Brown = 10,
        Green = 11,
        DarkGreen = 12,
        Beige = 13,
        DarkGray = 14,
        SkyBlue = 15,
        Turquoise = 16
    }
}
