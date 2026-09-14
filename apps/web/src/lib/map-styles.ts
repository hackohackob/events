/**
 * Base map styles shared by every MapLibre surface in the dashboard — the live
 * operations map and the deployment planner. Kept in one module because the
 * style objects have to be REFERENCE-stable: react-map-gl compares `mapStyle`
 * by identity, so a second copy of these constants would make one of the two
 * maps reload its style on every render.
 */
import type { StyleSpecification, RasterDEMSourceSpecification } from 'maplibre-gl'

export const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json'

export type BaseLayer = 'streets' | 'satellite' | 'terrain'

/** Minimal single-source raster style (no glyphs needed — all overlays are line/
 *  heatmap layers or DOM markers). `maxzoom` is the source's DATA max zoom:
 *  past it maplibre overzooms (upscales) the last available tiles instead of
 *  requesting levels the server doesn't have — without it, deep zooming turns
 *  satellite/terrain into blank error tiles. */
function rasterStyle(tiles: string, attribution: string, maxzoom: number): StyleSpecification {
  return {
    version: 8,
    sources: { base: { type: 'raster', tiles: [tiles], tileSize: 256, attribution, maxzoom } },
    layers: [{ id: 'base', type: 'raster', source: 'base' }],
  }
}

// 3D terrain elevation: keyless AWS Terrain Tiles (Terrarium encoding), driven
// by the standalone 3D toggle — available on every base layer.
const TERRAIN_DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const TERRAIN_EXAGGERATION = 1.6
/** Pitch applied when switching into the 3D view. */
export const TERRAIN_PITCH = 60

const TERRAIN_DEM_SOURCE: RasterDEMSourceSpecification = {
  type: 'raster-dem',
  tiles: [TERRAIN_DEM_TILES],
  encoding: 'terrarium',
  tileSize: 256,
  maxzoom: 15,
}

// The DEM source + `terrain` live INSIDE the style JSON — not as a <Source>
// child + `terrain` prop. react-map-gl re-attaches style components right after
// the style loads, and terrain attached before its just-added DEM source has
// loaded makes the first wave of DEM tiles error pre-fetch; errored terrain
// tiles are never retried, so the map silently renders flat. Baked into the
// style, maplibre sequences source load → terrain itself.
function with3d(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    sources: { ...style.sources, 'terrain-dem': TERRAIN_DEM_SOURCE },
    terrain: { source: 'terrain-dem', exaggeration: TERRAIN_EXAGGERATION },
  }
}

// Built once at module level: react-map-gl compares mapStyle by REFERENCE, so a
// fresh object per render triggers a full setStyle() reload on every re-render
// (visible glitch, and a maplibre "shaderPreludeCode" crash when the 3D terrain
// depth pass renders mid style-swap).
const SATELLITE_STYLE = rasterStyle(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  '© Esri, Maxar',
  18,
)
const TERRAIN_STYLE = rasterStyle(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  '© Esri',
  17,
)
const SATELLITE_3D_STYLE = with3d(SATELLITE_STYLE)
const TERRAIN_3D_STYLE = with3d(TERRAIN_STYLE)

// Streets is a remote vector style URL, so its 3D variant can't be built
// statically — the JSON is fetched once, merged with the DEM, and cached at
// module level (same reference-stability requirement as above).
let streets3dCached: StyleSpecification | null = null
let streets3dPromise: Promise<StyleSpecification | null> | null = null
/** True once the merged streets+DEM style is cached and `styleFor` can serve it. */
export function isStreets3dReady(): boolean {
  return streets3dCached !== null
}

export function loadStreets3dStyle(): Promise<StyleSpecification | null> {
  if (!streets3dPromise) {
    streets3dPromise = fetch(MAP_STYLE)
      .then(r => r.json())
      .then((s: StyleSpecification) => {
        streets3dCached = with3d(s)
        return streets3dCached
      })
      .catch(() => {
        streets3dPromise = null // allow a retry on the next toggle
        return null
      })
  }
  return streets3dPromise
}

/** Base map style per selected layer (+ optional 3D DEM variant). Satellite +
 *  terrain use keyless Esri rasters; streets is the default Carto vector style.
 *  Streets 3D falls back to the flat URL until the merged style is cached. */
export function styleFor(base: BaseLayer, want3d: boolean): string | StyleSpecification {
  if (base === 'satellite') return want3d ? SATELLITE_3D_STYLE : SATELLITE_STYLE
  if (base === 'terrain') return want3d ? TERRAIN_3D_STYLE : TERRAIN_STYLE
  return want3d && streets3dCached ? streets3dCached : MAP_STYLE
}

