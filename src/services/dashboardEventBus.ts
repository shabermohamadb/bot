import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

export type DashboardEventType =
  | 'party:created'
  | 'party:updated'
  | 'party:status_changed'
  | 'registration:created'
  | 'registration:switched'
  | 'registration:removed';

export interface DashboardEvent {
  id: string;
  type: DashboardEventType;
  partyId: string;
  timestamp: string;
  data?: Record<string, any>;
}

class DashboardEventBus extends EventEmitter {
  private recentEvents: DashboardEvent[] = [];
  private readonly maxRecent = 50;

  constructor() {
    super();
    // Allow multiple concurrent web and internal subscribers without memory leak warning
    this.setMaxListeners(100);
  }

  /**
   * Publishes an event to all subscribers after a successful database commit.
   */
  public publish(
    event: Omit<DashboardEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
  ): DashboardEvent {
    const fullEvent: DashboardEvent = {
      id: event.id || randomUUID(),
      type: event.type,
      partyId: event.partyId,
      timestamp: event.timestamp || new Date().toISOString(),
      data: event.data,
    };

    // Store in circular buffer for reconnecting clients
    this.recentEvents.unshift(fullEvent);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.length = this.maxRecent;
    }

    logger.debug({ event: fullEvent }, 'Publishing dashboard event');
    this.emit('event', fullEvent);
    this.emit(fullEvent.type, fullEvent);

    return fullEvent;
  }

  /**
   * Returns recent events for catch-up or verification.
   */
  public getRecent(sinceTimestamp?: string, limit = 20): DashboardEvent[] {
    let list = this.recentEvents;
    if (sinceTimestamp) {
      const sinceDate = new Date(sinceTimestamp).getTime();
      list = list.filter((e) => new Date(e.timestamp).getTime() > sinceDate);
    }
    return list.slice(0, limit);
  }
}

export const dashboardEventBus = new DashboardEventBus();

/**
 * Convenient helper to publish an event.
 */
export function publishDashboardEvent(
  type: DashboardEventType,
  partyId: string,
  data?: Record<string, any>
): DashboardEvent {
  return dashboardEventBus.publish({ type, partyId, data });
}
