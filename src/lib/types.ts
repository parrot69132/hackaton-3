/** Tipos derivados del contrato de Swagger (openapi 3.1.0, Lumon API 2.0.0). */

export type Bin = 'WO' | 'FC' | 'DR' | 'MA';
export const BINS: readonly Bin[] = ['WO', 'FC', 'DR', 'MA'] as const;

export const BIN_LABEL: Record<Bin, string> = {
  WO: 'WO',
  FC: 'FC',
  DR: 'DR',
  MA: 'MA',
};

/** Letra con la que el tile marca una celda ya refinada. */
export const BIN_FROM_CHAR: Record<string, Bin> = {
  W: 'WO',
  F: 'FC',
  D: 'DR',
  M: 'MA',
};

export type Permission =
  | 'files:read'
  | 'files:refine'
  | 'refiners:read'
  | 'refiners:write'
  | 'media:upload'
  | 'incidents:read'
  | 'incidents:create'
  | 'team:manage';

export interface User {
  id: number;
  email: string;
  displayName: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginResponse extends TokenPair {
  user: User;
}

export interface RegisterResponse extends LoginResponse {
  team: { code: string; name: string };
}

export interface Me {
  id: number;
  email: string;
  displayName: string;
  team: { code: string; name: string };
  role: { code: string; name: string };
  permissions: Permission[];
  clearance: { granted: boolean; grantedAt: string | null };
}

export interface Progress {
  WO: number;
  FC: number;
  DR: number;
  MA: number;
  overall: number;
}

export type FileStatus = 'ACTIVE' | 'COMPLETE';

export interface DataFile {
  id: number;
  name: string;
  rows: number;
  cols: number;
  tileSize: number;
  status: FileStatus;
  progress: Progress;
  refinedGroups: number;
  totalGroups: number;
  mistakes: number;
  updatedAt: string;
}

export interface FilePage {
  content: DataFile[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: PageSize;
}

export type PageSize = 10 | 25 | 50;
export const PAGE_SIZES: readonly PageSize[] = [10, 25, 50] as const;

export type SortOption = 'progress,desc' | 'name,asc' | 'updatedAt,desc';
export const SORT_OPTIONS: readonly SortOption[] = [
  'updatedAt,desc',
  'name,asc',
  'progress,desc',
] as const;

export type BinningStrategy = 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD';

export interface Rules {
  tremorThreshold: number;
  connectivity: 4 | 8;
  minGroupSize: number;
  maxGroupSize: number;
  binning: {
    strategy: BinningStrategy;
    order: Bin[];
  };
}

export interface Tile {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  /** Un digito por celda, por filas. */
  values: string;
  /** Bytes de temblor en base64, un byte por celda. */
  tremor: string;
  /** '.' sin refinar, o W/F/D/M. */
  bins: string;
  version: number;
}

export interface Cell {
  r: number;
  c: number;
}

export interface RefineResult {
  refinementId: number;
  bin: Bin;
  size: number;
  file: {
    progress: Progress;
    refinedGroups: number;
    totalGroups: number;
    mistakes: number;
    status: FileStatus;
  };
}

export interface Check {
  key: string;
  label: string;
  passed: boolean;
  reason: string | null;
}

export interface ClearanceCheck {
  key: string;
  label: string;
  passed: boolean;
  reason: string | null;
}

export interface RosterMember {
  name: string;
  code: string;
}

export interface Roster {
  members: RosterMember[];
  complete: boolean;
  locked: boolean;
}

export interface RoundState {
  [key: string]: unknown;
}

export interface Clearance {
  granted: boolean;
  grantedAt: string | null;
  checks: ClearanceCheck[];
  checkedAt: string | null;
  workspace: { kind: 'DEV' | 'EVAL'; chaosLevel: 0 | 1 | 2 };
  roster: Roster;
  round: RoundState;
}

export interface ClearanceCheckResult {
  granted: boolean;
  grantedAt: string | null;
  checks: ClearanceCheck[];
}

export interface IntegrationStatus {
  deploy: {
    origin: string | null;
    verifiedAt: string | null;
    lastBuildSeen: string | null;
    lastBuildSeenAt: string | null;
    pendingChallenge: { origin: string; expiresAt: string } | null;
  };
  storage: {
    provider: 'SUPABASE' | 'CLOUDINARY' | null;
    verifiedAt: string | null;
    checks: Check[];
    config: Record<string, string> | null;
  };
  clearance: { granted: boolean; grantedAt: string | null };
}

export interface Health {
  status: string;
  service: string;
  time: string;
}

export interface DeployChallenge {
  origin: string;
  token: string;
  wellKnownPath: string;
  expiresAt: string;
}

export interface Department {
  id: number;
  code: string;
  name: string;
}

export interface Badge {
  url: string;
  width: number;
  height: number;
}

export interface Refiner {
  id: number;
  fullName: string;
  department: Department;
  title: string;
  extension: string;
  /** Texto del exterior: puede traer HTML. Se muestra SIEMPRE como texto. */
  bio: string;
  profileUrl: string | null;
  badge: Badge | null;
  version: number;
  updatedAt: string;
}

export interface RefinerPage {
  content: Refiner[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: PageSize;
}

export interface RefinerPatch {
  title?: string;
  extension?: string;
  bio?: string;
  departmentId?: number;
}
