// invariant-harness.mjs — RE-EXPORT SHIM (M3.05 convergence).
//
// This file briefly held a second copy of the §7.3 checker, extracted
// by the M3.01 arm at the same hour the M3.05 arm extracted it into
// ../invariant.mjs. Two copies of the centrepiece checker is exactly
// the drift the invariant exists to prevent, so the implementation
// lives ONLY in ../invariant.mjs; this shim keeps the import path the
// reconstructed-journeys suite was written against.
export {
  checkContinuity,
  mutantPositionAt,
  polyline,
  routeDistance,
  matchOnSegment,
  maxLegRate,
  zeroTickLengthAt,
} from '../invariant.mjs';
