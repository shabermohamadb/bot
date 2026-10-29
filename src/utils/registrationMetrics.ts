import { logger } from './logger';

export interface RegistrationTimings {
  parseMs: number;
  partyLookupMs: number;
  dbTransactionMs: number;
  confirmationReplyMs: number;
  criticalPathTotalMs: number;
  announcementUpdateMs: number;
  endToEndTotalMs: number;
}

export interface LatencyStats {
  count: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
}

class RegistrationMetricsCollector {
  private readonly history: number[] = [];
  private readonly maxSamples = 100;

  public record(criticalPathMs: number): void {
    this.history.push(criticalPathMs);
    if (this.history.length > this.maxSamples) {
      this.history.shift();
    }
  }

  public getStats(): LatencyStats {
    if (this.history.length === 0) {
      return { count: 0, p50Ms: 0, p95Ms: 0, minMs: 0, maxMs: 0, avgMs: 0 };
    }

    const sorted = [...this.history].sort((a, b) => a - b);
    const count = sorted.length;
    const minMs = Math.round(sorted[0] * 10) / 10;
    const maxMs = Math.round(sorted[count - 1] * 10) / 10;
    const avgMs = Math.round((sorted.reduce((a, b) => a + b, 0) / count) * 10) / 10;

    const p50Index = Math.floor(count * 0.5);
    const p95Index = Math.min(Math.floor(count * 0.95), count - 1);

    const p50Ms = Math.round(sorted[p50Index] * 10) / 10;
    const p95Ms = Math.round(sorted[p95Index] * 10) / 10;

    return { count, p50Ms, p95Ms, minMs, maxMs, avgMs };
  }
}

export const metricsCollector = new RegistrationMetricsCollector();

export class RegistrationTracker {
  private readonly t0: number;
  private tParsed: number = 0;
  private tPartyLookup: number = 0;
  private tDbTx: number = 0;
  private tConfirmationSent: number = 0;
  private tAnnouncementUpdated: number = 0;
  private action: string = 'UNKNOWN';
  private roleNumber?: number;
  private partyId?: string;

  constructor(
    public readonly traceId: string,
    public readonly userId: string,
    public readonly threadId: string
  ) {
    this.t0 = performance.now();
  }

  public markParsed(): void {
    this.tParsed = performance.now();
  }

  public markPartyLookup(partyId?: string): void {
    this.tPartyLookup = performance.now();
    this.partyId = partyId;
  }

  public markDbTransactionCompleted(action: string, roleNumber?: number): void {
    this.tDbTx = performance.now();
    this.action = action;
    this.roleNumber = roleNumber;
  }

  public markConfirmationSent(): void {
    this.tConfirmationSent = performance.now();
    const criticalPathMs = Math.round((this.tConfirmationSent - this.t0) * 10) / 10;
    metricsCollector.record(criticalPathMs);
  }

  public markAnnouncementUpdated(): void {
    this.tAnnouncementUpdated = performance.now();
    this.logMetrics();
  }

  public logCriticalPathOnly(outcome: string): void {
    if (!this.tConfirmationSent) {
      this.tConfirmationSent = performance.now();
      metricsCollector.record(Math.round((this.tConfirmationSent - this.t0) * 10) / 10);
    }
    this.action = outcome;
    this.logMetrics();
  }

  private logMetrics(): void {
    const parseMs = this.tParsed ? Math.round((this.tParsed - this.t0) * 10) / 10 : 0;
    const partyLookupMs = this.tPartyLookup ? Math.round((this.tPartyLookup - (this.tParsed || this.t0)) * 10) / 10 : 0;
    const dbTransactionMs = this.tDbTx ? Math.round((this.tDbTx - (this.tPartyLookup || this.t0)) * 10) / 10 : 0;
    const confirmationReplyMs = this.tConfirmationSent ? Math.round((this.tConfirmationSent - (this.tDbTx || this.t0)) * 10) / 10 : 0;
    const criticalPathTotalMs = Math.round(((this.tConfirmationSent || performance.now()) - this.t0) * 10) / 10;
    const announcementUpdateMs = this.tAnnouncementUpdated ? Math.round((this.tAnnouncementUpdated - this.tConfirmationSent) * 10) / 10 : 0;
    const endToEndTotalMs = Math.round(((this.tAnnouncementUpdated || this.tConfirmationSent || performance.now()) - this.t0) * 10) / 10;

    const stats = metricsCollector.getStats();

    logger.info(
      {
        traceId: this.traceId,
        userId: this.userId,
        threadId: this.threadId,
        partyId: this.partyId,
        action: this.action,
        roleNumber: this.roleNumber,
        timings: {
          parseMs,
          partyLookupMs,
          dbTransactionMs,
          confirmationReplyMs,
          criticalPathTotalMs,
          announcementUpdateMs,
          endToEndTotalMs,
        },
        rollingStats: stats,
      },
      `⚡ [REGISTRATION TIMING] ${this.action} criticalPath=${criticalPathTotalMs}ms (p50=${stats.p50Ms}ms, p95=${stats.p95Ms}ms)`
    );
  }
}

