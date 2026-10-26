// Contrat JSON partagé avec le backend Go (voir shared-context.md).

export type SectionKind = 'room' | 'per_bedroom' | 'topic' | 'summary';
export type PointType = 'note' | 'constat' | 'case';

export interface Template { version: number; packing_list: string; sections: TemplateSection[] }
export interface TemplateSection {
  id: string; name: string; kind: SectionKind; position: number;
  points: TemplatePoint[]; questions: TemplateQuestion[];
}
export interface TemplatePoint {
  id: string; label: string; type: PointType; options: string[]; weight: number; position: number;
}
export interface TemplateQuestion { id: string; text: string; position: number; important: boolean }

export interface Fiche {
  address: string; price_eur: number | null; living_area_m2: number | null;
  floor_area_m2: number | null; land_area_m2: number | null; visit_at: string | null;
  agent_name: string | null; agent_phone: string | null; agent_email: string | null;
  construction_year: number | null; dpe_energy: string | null; dpe_ges: string | null;
  rooms_count: number | null; bedrooms_count: number | null; listing_url: string | null;
  heating_type: string | null;
}

export interface VisitInfo {
  code: string; is_creator: boolean; created_at: string; closed_at: string | null;
  fiche: Fiche; packing_list: string; participants: number;
}
export interface Room {
  id: string; name: string; dir_name: string; kind: SectionKind; position: number; hidden: boolean;
}
export interface Point {
  id: string; room_id: string; label: string; type: PointType; options: string[];
  weight: number; position: number;
}
export interface Question { id: string; room_id: string; text: string; position: number }
export type SharedField = 'value' | 'blocking' | 'works_eur' | 'answer' | 'asked' | 'area_m2' | 'notes';
export interface SharedValue {
  target_id: string; field: SharedField; value: unknown; updated_at: number;
  author: number; // numéro du participant
}
export interface Rating { point_id: string; value: number | null; updated_at: number }
export interface Comment { room_id: string; text: string; updated_at: number }
export interface Photo { id: string; room_id: string | null; author: number; taken_at: string }

export interface VisitState {
  seq: number; me: { number: number }; visit: VisitInfo; rooms: Room[]; points: Point[];
  questions: Question[]; shared: SharedValue[]; ratings: Rating[]; comments: Comment[];
  photos: Photo[];
}

export type OpType = 'add_room' | 'rename_room' | 'hide_room' | 'add_point' | 'add_question'
  | 'set_rating' | 'set_comment' | 'set_shared' | 'set_fiche' | 'close_visit';
export interface Op { op_id: string; type: OpType; client_ts: number; payload: object }
export interface OpResult {
  op_id: string; result: 'applied' | 'duplicate' | 'rejected';
  reason?: 'closed' | 'forbidden' | 'not_found' | 'invalid';
}
export interface OpsResponse { seq: number; results: OpResult[] }
/** Corps de POST /api/visits/{code}/ops. */
export interface OpsRequest { ops: Op[] }

export interface CreateVisitRequest {
  code: string; fiche: Fiche;
  /** Identifiants des sections `room` décochées ; omis si le modèle n'a pas pu être chargé. */
  excluded_section_ids?: string[];
}
export interface JoinResponse { number: number }
export interface ExistsResponse { exists: boolean }
export interface ErrorResponse { error: string }
