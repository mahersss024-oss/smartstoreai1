import { check, group } from 'k6';

import { assertSafeReadScenario, loadEnv } from '../config/environment.js';
import { timedPost } from '../helpers/http.js';
import { handleSummary } from '../helpers/summary.js';

assertSafeReadScenario();

if (!loadEnv.sessionCookie) {
  throw new Error('Chat load tests require K6_SESSION_COOKIE for a test account.');
}

export const options = {
  scenarios: {
    chat_read_like_flow: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: Math.min(loadEnv.maxVus, 10) },
        { duration: loadEnv.duration, target: loadEnv.maxVus },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    checks: ['rate==1'],
    'http_req_duration{endpoint:chat_api}': ['p(95)<45000'],
  },
};

export { handleSummary };

export default function chatReadFlow() {
  group('documented platform help', () => {
    const response = timedPost(
      '/api/chat',
      'chat_api',
      JSON.stringify({
        messages: [
          {
            id: `load-platform-help-${__VU}-${__ITER}`,
            role: 'user',
            parts: [{ type: 'text', text: 'كيف أنشئ إعلانًا وأراجع مسودته في المنصة؟' }],
          },
        ],
        locationSettings: { country: 'SA', currency: 'SAR', language: 'ar' },
      }),
      { timeout: '90s' },
    );
    check(response, {
      'chat reply completes': result => result.status === 200 && String(result.body).includes('"type":"finish"'),
      'chat provider is available': result => !String(result.body).includes('تعذر إكمال رد') &&
        !String(result.body).includes('أنا حمد، مساعدك في سوق حمد.') &&
        !String(result.body).includes('يسعدني مساعدتك في تجهيز مسودة إعلان أو الإجابة عن المنصة وسياساتها.'),
    });
  });
}
