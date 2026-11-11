import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import {
  JoinResponse, Listing, Op, OpsRequest, OpsResponse, Template, VisitState,
} from './api.types';
import { getDeviceId } from './device-id';

/** Erreur HTTP normalisée ; status 0 = erreur réseau. */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly body: unknown = null) {
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
    return new ApiError(
      e.status, fromBody || (e.status === 0 ? 'Réseau indisponible' : e.statusText || 'Erreur'), e.error,
    );
  }
  return new ApiError(0, e instanceof Error ? e.message : String(e));
}

const BASE = '/api';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  private async call<T>(run: (headers: HttpHeaders) => Observable<T>): Promise<T> {
    try {
      const headers = new HttpHeaders({ 'X-Device-Id': getDeviceId() });
      return await firstValueFrom(run(headers));
    } catch (e) {
      throw toApiError(e);
    }
  }

  private v(id: string): string {
    return `${BASE}/listings/${encodeURIComponent(id)}/visit`;
  }

  listListings(): Promise<Listing[]> {
    return this.call((headers) => this.http.get<Listing[]>(`${BASE}/listings`, { headers }));
  }

  createListing(text: string): Promise<Listing> {
    return this.call((headers) => this.http.post<Listing>(`${BASE}/listings`, { text }, { headers }));
  }

  getListing(id: string): Promise<Listing> {
    return this.call((headers) => this.http.get<Listing>(`${BASE}/listings/${encodeURIComponent(id)}`, { headers }));
  }

  patchListing(id: string, fields: Partial<Listing>): Promise<Listing> {
    return this.call((headers) =>
      this.http.patch<Listing>(`${BASE}/listings/${encodeURIComponent(id)}`, fields, { headers }),
    );
  }

  deleteListing(id: string): Promise<void> {
    return this.call((headers) =>
      this.http.delete(`${BASE}/listings/${encodeURIComponent(id)}`, { headers }),
    ).then(() => undefined);
  }

  refreshListing(id: string): Promise<Listing> {
    return this.call((headers) =>
      this.http.post<Listing>(`${BASE}/listings/${encodeURIComponent(id)}/refresh`, {}, { headers }),
    );
  }

  listingPhotoUrl(id: string, photoId: string): string {
    return `${BASE}/listings/${encodeURIComponent(id)}/photos/${encodeURIComponent(photoId)}`;
  }

  join(id: string): Promise<JoinResponse> {
    return this.call((headers) => this.http.post<JoinResponse>(`${this.v(id)}/join`, {}, { headers }));
  }

  state(id: string): Promise<VisitState> {
    return this.call((headers) => this.http.get<VisitState>(this.v(id), { headers }));
  }

  changes(id: string, since: number): Promise<VisitState> {
    const params = new HttpParams().set('since', String(since));
    return this.call((headers) => this.http.get<VisitState>(`${this.v(id)}/changes`, { headers, params }));
  }

  sendOps(id: string, ops: Op[]): Promise<OpsResponse> {
    const body: OpsRequest = { ops };
    return this.call((headers) => this.http.post<OpsResponse>(`${this.v(id)}/ops`, body, { headers }));
  }

  uploadPhoto(
    id: string,
    p: { id: string; room_id: string | null; taken_at: string; blob: Blob },
  ): Promise<void> {
    const form = new FormData();
    form.append('id', p.id);
    form.append('room_id', p.room_id ?? '');
    form.append('taken_at', p.taken_at);
    form.append('file', p.blob, `${p.id}.jpg`);
    return this.call((headers) =>
      this.http.post(`${this.v(id)}/photos`, form, { headers }),
    ).then(() => undefined);
  }

  /** Les balises img n'envoient pas d'en-tête : l'appareil passe dans ?d=. */
  photoUrl(id: string, photoId: string, device: string): string {
    return `${this.v(id)}/photos/${encodeURIComponent(photoId)}?d=${encodeURIComponent(device)}`;
  }

  exportCsv(id: string, sep: 'semicolon' | 'tab'): Promise<Blob> {
    const params = sep === 'tab' ? new HttpParams().set('sep', 'tab') : new HttpParams();
    return this.call((headers) =>
      this.http.get(`${this.v(id)}/export.csv`, { headers, params, responseType: 'blob' }),
    );
  }

  getTemplate(): Promise<Template> {
    return this.call((headers) => this.http.get<Template>(`${BASE}/template`, { headers }));
  }

  putTemplate(t: Template): Promise<Template> {
    return this.call((headers) => this.http.put<Template>(`${BASE}/template`, t, { headers }));
  }
}
