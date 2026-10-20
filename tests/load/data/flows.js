import { loadEnv } from '../config/environment.js';

function pick(values, index) {
  if (!values.length) return '';
  return values[index % values.length];
}

export function searchTerm() {
  return pick(loadEnv.searchTerms, __VU + __ITER);
}

export function city() {
  return pick(loadEnv.cities, __VU * 3 + __ITER);
}

export function configuredListingId() {
  return pick(loadEnv.listingIds, __VU + __ITER);
}
