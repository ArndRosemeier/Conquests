// The published `polygon-clipping` types declare named exports, but the ESM
// bundle only ships a default export object. Augment the module with a matching
// default so both the type checker and the bundler agree.
declare module "polygon-clipping" {
  type Geom = Polygon | MultiPolygon;
  const polygonClipping: {
    union(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    intersection(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    xor(geom: Geom, ...geoms: Geom[]): MultiPolygon;
    difference(subjectGeom: Geom, ...clipGeoms: Geom[]): MultiPolygon;
  };
  export default polygonClipping;
}
