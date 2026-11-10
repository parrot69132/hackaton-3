import { apiFetch } from '../api';
import { WS_BASE_URL } from '../env';
import { backoffDelay } from '../backoff';
import type { Cell } from '../types';

/**
 * Piso compartido (CP5): WebSocket NATIVO con ticket nuevo en cada conexion.
 * No es Socket.IO.
 */

export interface FloorMember {
  userId: number;
  displayName: string;
  cursor: Cell | null;
}

export interface FloorClaim {
  claimId: string;
  userId: number;
  displayName: string;
  cells: Cell[];
  expiresAt: string;
}

export type FloorStatus = 'connecting' | 'open' | 'retrying' | 'closed';

export interface FloorState {
  status: FloorStatus;
  members: FloorMember[];
  claims: FloorClaim[];
  myClaimId: string | null;
  lastDenial: { reason: string; holder: string | null } | null;
  fatal: string | null;
}

type Listener = (state: FloorState) => void;

const PING_MS = 15_000;
const CURSOR_MS = 100; // maximo 10 mensajes por segundo

interface ServerMessage {
  type: string;
  seq?: number;
  members?: Array<{ userId: number; displayName: string; cursor?: Cell | null }>;
  claims?: FloorClaim[];
  userId?: number;
  displayName?: string;
  r?: number;
  c?: number;
  requestId?: string;
  claimId?: string;
  cells?: Cell[];
  expiresAt?: string;
  reason?: string;
  holder?: string | null;
  t?: number;
}

export class FloorSocket {
  private ws: WebSocket | null = null;
  private seq = 0;
  private attempt = 0;
  private pingTimer: number | null = null;
  private renewTimer: number | null = null;
  private cursorTimer: number | null = null;
  private pendingCursor: Cell | null = null;
  private lastCursorSent = 0;
  private missedPongs = 0;
  private disposed = false;
  private pendingClaim: string | null = null;

  private state: FloorState = {
    status: 'connecting',
    members: [],
    claims: [],
    myClaimId: null,
    lastDenial: null,
    fatal: null,
  };

  private readonly listeners = new Set<Listener>();

  constructor(private readonly fileId: number) {}

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    l(this.state);
    return () => {
      this.listeners.delete(l);
    };
  }

  private patch(next: Partial<FloorState>): void {
    this.state = { ...this.state, ...next };
    for (const l of this.listeners) l(this.state);
  }

  getState(): FloorState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.disposed) return;
    this.patch({ status: this.attempt === 0 ? 'connecting' : 'retrying' });

    let ticket: string;
    try {
      const res = await apiFetch<{ ticket: string; expiresIn: number }>('/floor/tickets', {
        method: 'POST',
        body: { fileId: this.fileId },
        retries: 1,
      });
      ticket = res.data.ticket;
    } catch {
      this.scheduleRetry();
      return;
    }
    if (this.disposed) return;

    const ws = new WebSocket(`${WS_BASE_URL}/floor/ws?ticket=${encodeURIComponent(ticket)}`);
    this.ws = ws;

    ws.onopen = (): void => {
      this.attempt = 0;
      this.missedPongs = 0;
      this.patch({ status: 'open', fatal: null });
      this.startPing();
    };

    ws.onmessage = (ev: MessageEvent<string>): void => this.onMessage(ev.data);

    ws.onclose = (ev: CloseEvent): void => {
      this.stopPing();
      if (this.ws === ws) this.ws = null;
      if (this.disposed) return;
      this.handleClose(ev.code, ev.reason);
    };
  }

  /** La causa del cierre decide si se reconecta y con cuanta espera. */
  private handleClose(code: number, reason: string): void {
    switch (code) {
      case 4400:
        this.patch({ status: 'closed', fatal: 'Mensaje invalido enviado por la app.' });
        return;
      case 4403:
        this.patch({ status: 'closed', fatal: 'Origen no verificado o sin permiso.' });
        return;
      case 4404:
        this.patch({ status: 'closed', fatal: 'El archivo no existe.' });
        return;
      case 4423:
        this.patch({ status: 'closed', fatal: 'El Piso de Pruebas aun no esta abierto.' });
        return;
      case 4401:
        // Ticket invalido o usado: se pide uno nuevo, pero sin insistir.
        if (this.attempt >= 2) {
          this.patch({ status: 'closed', fatal: 'No se pudo autenticar el piso.' });
          return;
        }
        this.scheduleRetry(500);
        return;
      case 4429:
        this.scheduleRetry(10_000);
        return;
      default:
        this.scheduleRetry(undefined, reason);
    }
  }

  private scheduleRetry(fixedDelay?: number, _reason?: string): void {
    if (this.disposed) return;
    const delay = fixedDelay ?? backoffDelay(Math.min(this.attempt, 6), 1_000, 20_000);
    this.attempt += 1;
    this.patch({ status: 'retrying', members: [], claims: [], myClaimId: null });
    window.setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }

    // Un salto en seq significa que se perdio algo: se pide el estado completo.
    if (typeof msg.seq === 'number') {
      if (this.seq !== 0 && msg.seq > this.seq + 1 && msg.type !== 'snapshot') {
        this.send({ type: 'resync' });
        this.seq = msg.seq;
        return;
      }
      this.seq = msg.seq;
    }

    switch (msg.type) {
      case 'snapshot': {
        const members = (msg.members ?? []).map((m) => ({
          userId: m.userId,
          displayName: m.displayName,
          cursor: m.cursor ?? null,
        }));
        const claims = msg.claims ?? [];
        const mine = this.pendingClaim;
        this.patch({
          members: dedupeMembers(members),
          claims,
          myClaimId: mine !== null && claims.some((c) => c.claimId === mine) ? mine : null,
        });
        return;
      }
      case 'member.joined': {
        if (msg.userId === undefined) return;
        const next = dedupeMembers([
          ...this.state.members,
          { userId: msg.userId, displayName: msg.displayName ?? 'Refinador', cursor: null },
        ]);
        this.patch({ members: next });
        return;
      }
      case 'member.left': {
        this.patch({ members: this.state.members.filter((m) => m.userId !== msg.userId) });
        return;
      }
      case 'cursor': {
        if (msg.userId === undefined || msg.r === undefined || msg.c === undefined) return;
        this.patch({
          members: this.state.members.map((m) =>
            m.userId === msg.userId ? { ...m, cursor: { r: msg.r as number, c: msg.c as number } } : m,
          ),
        });
        return;
      }
      case 'claim.granted': {
        if (msg.claimId === undefined) return;
        const claim: FloorClaim = {
          claimId: msg.claimId,
          userId: msg.userId ?? -1,
          displayName: msg.displayName ?? 'yo',
          cells: msg.cells ?? [],
          expiresAt: msg.expiresAt ?? '',
        };
        const mine = msg.requestId !== undefined && msg.requestId === this.pendingClaim;
        this.patch({
          claims: [...this.state.claims.filter((c) => c.claimId !== claim.claimId), claim],
          myClaimId: mine ? claim.claimId : this.state.myClaimId,
          lastDenial: null,
        });
        if (mine) this.startRenew(claim.claimId);
        return;
      }
      case 'claim.denied': {
        this.patch({
          lastDenial: { reason: msg.reason ?? 'HELD', holder: msg.holder ?? null },
        });
        return;
      }
      case 'claim.updated': {
        if (msg.claimId === undefined) return;
        const claim: FloorClaim = {
          claimId: msg.claimId,
          userId: msg.userId ?? -1,
          displayName: msg.displayName ?? 'otro refinador',
          cells: msg.cells ?? [],
          expiresAt: msg.expiresAt ?? '',
        };
        this.patch({
          claims: [...this.state.claims.filter((c) => c.claimId !== claim.claimId), claim],
        });
        return;
      }
      case 'claim.released': {
        this.patch({
          claims: this.state.claims.filter((c) => c.claimId !== msg.claimId),
          myClaimId: this.state.myClaimId === msg.claimId ? null : this.state.myClaimId,
        });
        return;
      }
      case 'pong': {
        this.missedPongs = 0;
        return;
      }
      default:
        return;
    }
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      // Dos pong sin llegar = conexion muerta.
      if (this.missedPongs >= 2) {
        this.ws?.close();
        return;
      }
      this.missedPongs += 1;
      this.send({ type: 'ping', t: Date.now() });
    }, PING_MS);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.renewTimer !== null) window.clearInterval(this.renewTimer);
    this.renewTimer = null;
  }

  private startRenew(claimId: string): void {
    if (this.renewTimer !== null) window.clearInterval(this.renewTimer);
    // La reserva vence a los 15 s si no se renueva.
    this.renewTimer = window.setInterval(() => {
      this.send({ type: 'renew', claimId });
    }, 7_000);
  }

  /** Maximo 10 por segundo, y nada si la pestana esta oculta. */
  moveCursor(cell: Cell): void {
    if (document.hidden) return;
    this.pendingCursor = cell;
    const now = Date.now();
    const wait = Math.max(0, CURSOR_MS - (now - this.lastCursorSent));
    if (this.cursorTimer !== null) return;
    this.cursorTimer = window.setTimeout(() => {
      this.cursorTimer = null;
      const pending = this.pendingCursor;
      if (pending === null || document.hidden) return;
      this.lastCursorSent = Date.now();
      this.send({ type: 'cursor', r: pending.r, c: pending.c });
    }, wait);
  }

  claim(cell: Cell): string {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pendingClaim = requestId;
    this.patch({ lastDenial: null });
    this.send({ type: 'claim', requestId, r: cell.r, c: cell.c });
    return requestId;
  }

  release(): void {
    const id = this.state.myClaimId;
    if (id !== null) this.send({ type: 'release', claimId: id });
    if (this.renewTimer !== null) window.clearInterval(this.renewTimer);
    this.renewTimer = null;
    this.pendingClaim = null;
    this.patch({ myClaimId: null });
  }

  dispose(): void {
    this.disposed = true;
    this.release();
    this.stopPing();
    if (this.cursorTimer !== null) window.clearTimeout(this.cursorTimer);
    this.ws?.close();
    this.ws = null;
  }
}

function dedupeMembers(members: FloorMember[]): FloorMember[] {
  // Un mismo usuario con varias pestanas figura UNA sola vez.
  const byId = new Map<number, FloorMember>();
  for (const m of members) {
    const existing = byId.get(m.userId);
    byId.set(m.userId, existing === undefined ? m : { ...existing, cursor: m.cursor ?? existing.cursor });
  }
  return [...byId.values()];
}
