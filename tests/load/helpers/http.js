import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

import { loadEnv, url } from '../config/environment.js';

const endpointDuration = new Trend('smartstore_endpoint_duration', true);
const endpointErrors = new Rate('smartstore_endpoint_errors');
const endpointClientErrors = new Rate('smartstore_endpoint_client_errors');
const endpointServerErrors = new Rate('smartstore_endpoint_server_errors');
const endpointRateLimited = new Rate('smartstore_endpoint_rate_limited');
const imageDuration = new Trend('smartstore_image_duration', true);
const imageErrors = new Rate('smartstore_image_errors');

function headers(extra = {}, includeSession = true) {
  const requestHeaders = {
    accept: 'application/json,text/html;q=0.9,*/*;q=0.8',
    'user-agent': 'SmartStoreAI-k6-load/1.0',
    ...extra,
  };

  if (includeSession && loadEnv.sessionCookie) {
    requestHeaders.cookie = loadEnv.sessionCookie;
  }

  return requestHeaders;
}

export function timedGet(path, name, params = {}) {
  const response = http.get(url(path), {
    timeout: params.timeout || '30s',
    tags: { endpoint: name },
    headers: headers(params.headers || {}),
    responseType: params.responseType || 'text',
  });

  endpointDuration.add(response.timings.duration, { endpoint: name });
  endpointErrors.add(response.status >= 400 || response.status === 0, {
    endpoint: name,
  });
  endpointClientErrors.add(response.status >= 400 && response.status < 500, {
    endpoint: name,
  });
  endpointServerErrors.add(response.status >= 500 || response.status === 0, {
    endpoint: name,
  });
  endpointRateLimited.add(response.status === 429, { endpoint: name });
  check(response, {
    [`${name} status < 400`]: (res) => res.status >= 200 && res.status < 400,
  });

  return response;
}

export function timedPost(path, name, body, params = {}) {
  const response = http.post(url(path), body, {
    timeout: params.timeout || '30s',
    tags: { endpoint: name },
    headers: headers({
      'content-type': 'application/json',
      ...(params.headers || {}),
    }),
  });

  endpointDuration.add(response.timings.duration, { endpoint: name });
  endpointErrors.add(response.status >= 400 || response.status === 0, {
    endpoint: name,
  });
  endpointClientErrors.add(response.status >= 400 && response.status < 500, {
    endpoint: name,
  });
  endpointServerErrors.add(response.status >= 500 || response.status === 0, {
    endpoint: name,
  });
  endpointRateLimited.add(response.status === 429, { endpoint: name });
  check(response, {
    [`${name} status < 400`]: (res) => res.status >= 200 && res.status < 400,
  });

  return response;
}

export function timedImageGet(imageUrl, name) {
  const response = http.get(imageUrl, {
    timeout: '30s',
    tags: { endpoint: name, asset_type: 'image' },
    responseType: 'none',
    // Public listing images can be hosted outside the application origin.
    headers: headers({ accept: 'image/avif,image/webp,image/*,*/*;q=0.8' }, false),
  });

  const validImage = response.status >= 200 && response.status < 400 &&
    /^image\//i.test(String(response.headers['Content-Type'] || ''));
  imageDuration.add(response.timings.duration, { endpoint: name });
  imageErrors.add(!validImage, {
    endpoint: name,
  });
  check(response, {
    [`${name} returns an image`]: () => validImage,
  });

  return response;
}

export function think(minSeconds = 0.3, maxSeconds = 1.5) {
  sleep(minSeconds + Math.random() * (maxSeconds - minSeconds));
}

export function parseJson(response, fallback = null) {
  try {
    return response.json();
  } catch {
    return fallback;
  }
}
