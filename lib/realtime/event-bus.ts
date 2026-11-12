import { RedisRealtimeRelay } from './redis-relay';
import {
  type PublishRealtimeEventInput,
  type RealtimeEvent,
  type RealtimeEventEnvelope,
  type RealtimeSubscriberContext,
  isRealtimeEventVisibleToSubscriber,
  normalizeRealtimeVisibility,
} from './events';

type RealtimeSubscriber = {
  context: RealtimeSubscriberContext;
  onEvent: (event: RealtimeEvent) => void;
};

const retainedEventsLimit = 2000;
const retainedBytesLimit = 4 * 1024 * 1024;
let retainedBytes = 0;
const retainedSizes: number[] = [];

let nextEventId = 0;
let nextSubscriberId = 0;

const retainedEvents: RealtimeEventEnvelope[] = [];
const subscribers = new Map<number, RealtimeSubscriber>();

const relay = new RedisRealtimeRelay(event => {
  // Keep numeric SSE replay IDs local to this replica and never relay an echo.
  retainAndDeliver({ ...event, id: ++nextEventId });
});

export function publishRealtimeEvent(
  input: PublishRealtimeEventInput,
): RealtimeEvent {
  const event = {
    id: ++nextEventId,
    occurredAt: new Date().toISOString(),
    payload: input.payload,
    type: input.type,
    visibility: normalizeRealtimeVisibility(input.visibility),
  } as RealtimeEventEnvelope;

  if (retainAndDeliver(event)) relay.publish(event);
  return event;
}

function retainAndDeliver(event: RealtimeEventEnvelope) {
  const size = Buffer.byteLength(JSON.stringify(event));
  // Hints are best-effort; authoritative reconciliation remains available. Do
  // not retain a frame too large for either the bounded relay or SSE replay.
  if (size > 16 * 1024 - 512) {
    console.warn('[realtime] oversized_event_omitted');
    return false;
  }
  retainedEvents.push(event);
  retainedSizes.push(size);
  retainedBytes += size;
  while (retainedEvents.length > retainedEventsLimit || retainedBytes > retainedBytesLimit) {
    retainedEvents.shift();
    retainedBytes -= retainedSizes.shift() ?? 0;
  }

  for (const subscriber of subscribers.values()) {
    if (!isRealtimeEventVisibleToSubscriber(event, subscriber.context)) {
      continue;
    }

    try {
      subscriber.onEvent(event);
    } catch {
      // Subscriber failures must not break event delivery.
    }
  }

  return true;
}

export function subscribeRealtimeEvents(
  context: RealtimeSubscriberContext,
  onEvent: (event: RealtimeEvent) => void,
) {
  const subscriberId = ++nextSubscriberId;

  subscribers.set(subscriberId, {
    context,
    onEvent,
  });

  relay.start();
  return () => {
    subscribers.delete(subscriberId);
    if (!subscribers.size) relay.stop();
  };
}

export function getRealtimeEventsSince(
  lastEventId: number | null,
  context: RealtimeSubscriberContext,
) {
  return retainedEvents.filter((event) => {
    if (typeof lastEventId === 'number' && event.id <= lastEventId) {
      return false;
    }

    return isRealtimeEventVisibleToSubscriber(event, context);
  });
}
