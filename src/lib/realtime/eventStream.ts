import { apiFetch } from '../api';
import { API_BASE_URL } from '../env';
import { backoffDelay } from '../backoff';

/**
 * Stream de eventos (CP5).
 *
 *  - Se autentica SOLO con un ticket de POST /events/tickets: dura 30 s y
 *    sirve una sola vez, asi que se pide uno nuevo en cada conexion.
 *  - UNA sola conexion por navegador aunque haya varias pestanas: la pestana
 *    que gana el Web Lock es la "lider" y reparte los eventos por
 *    BroadcastChannel. Si se cierra, otra pestana toma el relevo sola.
 *  - Reconexion con espera creciente y `lastEventId` para no perder eventos.
 *  - Conexion muerta: sin datos ni heartbeat por 45 s se cierra y se reconecta.
 *  - Ningun evento se aplica dos veces (dedupe por id).
 */

export type LumonEventType =
  | 'refiner.updated'
  | 'refinement.created'
  | 'file.completed'
  | 'contingency.activated'
  | 'contingency.resolved'
  | 'session.revoked'
  | 'stream.reset'
  | 'stream.superseded';

export const LUMON_EVENT_TYPES: readonly LumonEventType[] = [
  'refiner.updated',
  'refinement.created',
  'file.completed',
  'contingency.activated',
  'contingency.resolved',
  'session.revoked',
  'stream.reset',
  'stream.superseded',
];

export interface LumonEvent {
  id: number;
  type: LumonEventType;
  data: Record<string, unknown>;
}

export type StreamStatus = 'idle' | 'connecting' | 'open' | 'retrying' | 'stopped';

type EventListener = (event: LumonEvent) => void;
type StatusListener = (status: StreamStatus) => void;

const CHANNEL = 'lumon.events';
const LEADER_LOCK = 'lumon.events.leader';
const DEAD_MS = 45_000;

interface Relay {
  kind: 'event' | 'status';
  event?: LumonEvent;
  status?: StreamStatus;
}

class EventStream {
  private readonly listeners = new Set<EventListener>();
  private readonly statusListeners = new Set<StatusListener>();
  private readonly seen = new Set<number>();
  private channel: BroadcastChannel | null = null;
  private source: EventSource | null = null;
  private status: StreamStatus = 'idle';
  private lastEventId: number | null = null;
  private attempt = 0;
  private started = false;
  private stopped = false;
  private isLeader = false;
  private deadTimer: number | null = null;
  private retryTimer: number | null = null;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopped = false;

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (ev: MessageEvent<Relay>): void => {
        const msg = ev.data;
        if (msg.kind === 'event' && msg.event !== undefined) this.dispatch(msg.event, false);
        else if (msg.kind === 'status' && msg.status !== undefined && !this.isLeader) {
          this.setStatus(msg.status, false);
        }
      };
    }

    void this.becomeLeader();
  }

  /** La pestana que obtiene el lock mantiene la unica conexion del navegador. */
  private async becomeLeader(): Promise<void> {
    const locks = navigator.locks;
    if (locks === undefined) {
      this.isLeader = true;
      void this.connect();
      return;
    }
    await locks.request(LEADER_LOCK, async () => {
      if (this.stopped) return;
      this.isLeader = true;
      void this.connect();
      // Mantener el lock mientras viva la pestana: al cerrarse, otra toma el relevo.
      await new Promise<void>((resolve) => {
        this.releaseLeadership = resolve;
      });
    });
  }

  private releaseLeadership: (() => void) | null = null;

  private async connect(): Promise<void> {
    if (this.stopped || !this.isLeader) return;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'retrying');

    let ticket: string;
    try {
      const res = await apiFetch<{ ticket: string; expiresIn: number }>('/events/tickets', {
        method: 'POST',
        retries: 1,
      });
      ticket = res.data.ticket;
    } catch {
      this.scheduleRetry();
      return;
    }

    const url = new URL(`${API_BASE_URL}/events/stream`);
    url.searchParams.set('ticket', ticket);
    if (this.lastEventId !== null) url.searchParams.set('lastEventId', String(this.lastEventId));

    const source = new EventSource(url.toString());
    this.source = source;

    source.onopen = (): void => {
      this.attempt = 0;
      this.setStatus('open');
      this.armDeadTimer();
    };

    source.onerror = (): void => {
      // EventSource reintenta solo, pero necesitamos un ticket NUEVO cada vez.
      source.close();
      if (this.source === source) this.source = null;
      this.scheduleRetry();
    };

    for (const type of LUMON_EVENT_TYPES) {
      source.addEventListener(type, (ev: MessageEvent<string>) => {
        this.armDeadTimer();
        const id = Number(ev.lastEventId);
        let data: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(ev.data);
          if (typeof parsed === 'object' && parsed !== null) {
            data = parsed as Record<string, unknown>;
          }
        } catch {
          data = {};
        }
        if (Number.isFinite(id)) this.lastEventId = id;
        this.dispatch({ id: Number.isFinite(id) ? id : -1, type, data }, true);
        if (type === 'stream.superseded') {
          // Otra sesion tomo el stream: no insistir desde esta pestana.
          source.close();
          this.source = null;
          this.setStatus('stopped');
        }
      });
    }

    // Los heartbeat son comentarios SSE: no disparan eventos, pero sí reinician
    // el temporizador a traves de onmessage cuando llega cualquier dato.
    source.onmessage = (): void => this.armDeadTimer();
  }

  private armDeadTimer(): void {
    if (this.deadTimer !== null) window.clearTimeout(this.deadTimer);
    this.deadTimer = window.setTimeout(() => {
      this.source?.close();
      this.source = null;
      this.scheduleRetry();
    }, DEAD_MS);
  }

  private scheduleRetry(): void {
    if (this.stopped || !this.isLeader) return;
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.setStatus('retrying');
    const delay = backoffDelay(Math.min(this.attempt, 6), 1_000, 30_000);
    this.attempt += 1;
    this.retryTimer = window.setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private dispatch(event: LumonEvent, relay: boolean): void {
    if (event.id >= 0) {
      if (this.seen.has(event.id)) return; // nunca se aplica dos veces
      this.seen.add(event.id);
      if (this.seen.size > 2_000) {
        const oldest = this.seen.values().next().value;
        if (typeof oldest === 'number') this.seen.delete(oldest);
      }
    }
    for (const l of this.listeners) l(event);
    // Todas las pestanas se enteran de todos los eventos.
    if (relay) this.channel?.postMessage({ kind: 'event', event } satisfies Relay);
  }

  private setStatus(status: StreamStatus, relay = true): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of this.statusListeners) l(status);
    if (relay && this.isLeader) {
      this.channel?.postMessage({ kind: 'status', status } satisfies Relay);
    }
  }

  getStatus(): StreamStatus {
    return this.status;
  }

  subscribe(l: EventListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  subscribeStatus(l: StatusListener): () => void {
    this.statusListeners.add(l);
    return () => {
      this.statusListeners.delete(l);
    };
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    this.source?.close();
    this.source = null;
    if (this.deadTimer !== null) window.clearTimeout(this.deadTimer);
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.releaseLeadership?.();
    this.releaseLeadership = null;
    this.isLeader = false;
    this.setStatus('idle', false);
  }
}

export const eventStream = new EventStream();
