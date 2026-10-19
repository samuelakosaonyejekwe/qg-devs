/** Lazily loaded 3-D views (three.js). Import only via dynamic import() from 3-D view components. */
export type { Handle } from './core';
export { mountApparatus, type ApparatusOpts, type ApparatusInfo } from './apparatus';
export { mountBloch, type BlochOpts } from './bloch';
export { mountTrajectories, type TrajOpts } from './trajectories';
export { mountSurface, type SurfaceOpts } from './surface';
export { webglAvailable } from './detect';
