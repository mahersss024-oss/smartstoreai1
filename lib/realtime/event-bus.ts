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

let nextEventId = 0;
let nextSubscriberId = 0;

const retainedEvents: RealtimeEventEnvelope[] = [];
const subscribers = new Map<number, RealtimeSubscriber>();

function trimRetainedEvents() {
  if (retainedEvents.length <= retainedEventsLimit) {
    return;
  }

  retainedEvents.splice(0, retainedEvents.length - retainedEventsLimit);
}

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

  retainedEvents.push(event);
  trimRetainedEvents();

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

  return event;
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

  return () => {
    subscribers.delete(subscriberId);
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
