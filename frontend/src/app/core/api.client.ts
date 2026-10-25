import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import {
  CreateVisitRequest, ExistsResponse, JoinResponse, Op, OpsRequest, OpsResponse, Template,
  VisitState,
} from './api.types';
import { getDeviceId } from './device-id';

/** Erreur HTTP normalisée ; status 0 = erreur réseau. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof HttpErrorResponse) {
    const body = e.error as { error?: unknown } | null;
    const fromBody = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : '';
    return new ApiError(e.status, fromBody || (e.status === 0 ? 'Réseau indisponible' : e.statusText || 'Erreur'));
  }
  return new ApiError(0, e instanceof Error ? e.message : String(e));
}

const BASE = '/api';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  private async call<T>(run: (headers: HttpHeaders) => Observable<T>): Promise<T> {
    try {
      const headers = new HttpHeaders({ 'X-Device-Id': await getDeviceId() });
      return await firstValueFrom(run(headers));
    } catch (e) {
      throw toApiError(e);
    }
  }

  private v(code: string): string {
    return `${BASE}/visits/${encodeURIComponent(code)}`;
  }

  exists(code: string): Promise<ExistsResponse> {
    return this.call((headers) => this.http.get<ExistsResponse>(`${this.v(code)}/exists`, { headers }));
  }

  create(req: CreateVisitRequest): Promise<VisitState> {
    return this.call((headers) => this.http.post<VisitState>(`${BASE}/visits`, req, { headers }));
  }

  join(code: string): Promise<JoinResponse> {
    return this.call((headers) => this.http.post<JoinResponse>(`${this.v(code)}/join`, {}, { headers }));
  }

  state(code: string): Promise<VisitState> {
    return this.call((headers) => this.http.get<VisitState>(this.v(code), { headers }));
  }

  changes(code: string, since: number): Promise<VisitState> {
    const params = new HttpParams().set('since', String(since));
    return this.call((headers) => this.http.get<VisitState>(`${this.v(code)}/changes`, { headers, params }));
  }

  sendOps(code: string, ops: Op[]): Promise<OpsResponse> {
    const body: OpsRequest = { ops };
    return this.call((headers) => this.http.post<OpsResponse>(`${this.v(code)}/ops`, body, { headers }));
  }

  uploadPhoto(
    code: string,
    p: { id: string; room_id: string | null; taken_at: string; blob: Blob },
  ): Promise<void> {
    const form = new FormData();
    form.append('id', p.id);
    form.append('room_id', p.room_id ?? '');
    form.append('taken_at', p.taken_at);
    form.append('file', p.blob, `${p.id}.jpg`);
    return this.call((headers) =>
      this.http.post(`${this.v(code)}/photos`, form, { headers }),
    ).then(() => undefined);
  }

  photoUrl(code: string, id: string, device: string): string {
    return `${this.v(code)}/photos/${encodeURIComponent(id)}?d=${encodeURIComponent(device)}`;
  }

  exportCsv(code: string, sep: 'semicolon' | 'tab'): Promise<Blob> {
    const params = sep === 'tab' ? new HttpParams().set('sep', 'tab') : new HttpParams();
    return this.call((headers) =>
      this.http.get(`${this.v(code)}/export.csv`, { headers, params, responseType: 'blob' }),
    );
  }

  getTemplate(): Promise<Template> {
    return this.call((headers) => this.http.get<Template>(`${BASE}/template`, { headers }));
  }

  putTemplate(t: Template): Promise<Template> {
    return this.call((headers) => this.http.put<Template>(`${BASE}/template`, t, { headers }));
  }
}
