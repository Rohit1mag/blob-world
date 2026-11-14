import type { SavedSimulation } from '../engine/SimulationEngine';
import { getSupabase } from './supabase';

export interface WorldMeta {
  id: string;
  name: string;
  day: number;
  seed: number;
  updatedAt: string;
}

interface WorldRow {
  id: string;
  name: string;
  day: number;
  seed: number;
  updated_at: string;
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

export async function ensurePlayer(): Promise<string> {
  const supabase = client();
  const { data: existing, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (existing.session?.user.id) return existing.session.user.id;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error('Anonymous sign-in failed');
  return data.user.id;
}

function snapshotPath(userId: string, worldId: string): string {
  return `${userId}/${worldId}.json`;
}

function toMeta(row: WorldRow): WorldMeta {
  return { id: row.id, name: row.name, day: row.day, seed: row.seed, updatedAt: row.updated_at };
}

export async function listWorlds(): Promise<WorldMeta[]> {
  const { data, error } = await client()
    .from('worlds')
    .select('id, name, day, seed, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as WorldRow[]).map(toMeta);
}

export async function loadWorld(id: string): Promise<SavedSimulation> {
  const userId = await ensurePlayer();
  const { data, error } = await client().storage.from('worlds').download(snapshotPath(userId, id));
  if (error || !data) throw error ?? new Error('Missing world snapshot');
  return JSON.parse(await data.text()) as SavedSimulation;
}

async function uploadSnapshot(userId: string, id: string, snapshot: SavedSimulation): Promise<void> {
  const body = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  const { error } = await client().storage.from('worlds').upload(snapshotPath(userId, id), body, {
    upsert: true,
    contentType: 'application/json',
  });
  if (error) throw error;
}

export async function createWorld(snapshot: SavedSimulation): Promise<WorldMeta> {
  const userId = await ensurePlayer();
  const supabase = client();
  const name = `Seed ${snapshot.config.seed}`.slice(0, 80);
  const { data, error } = await supabase
    .from('worlds')
    .insert({ name, day: snapshot.day, seed: snapshot.config.seed })
    .select('id, name, day, seed, updated_at')
    .single();
  if (error || !data) throw error ?? new Error('Could not create world');
  const row = data as WorldRow;
  try {
    await uploadSnapshot(userId, row.id, snapshot);
  } catch (err) {
    await supabase.from('worlds').delete().eq('id', row.id);
    throw err;
  }
  return toMeta(row);
}

export async function saveWorld(id: string, snapshot: SavedSimulation): Promise<void> {
  const userId = await ensurePlayer();
  await uploadSnapshot(userId, id, snapshot);
  const { error } = await client()
    .from('worlds')
    .update({ day: snapshot.day, seed: snapshot.config.seed, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

let latest: { id: string; snapshot: SavedSimulation } | null = null;
let draining = false;
let reportError: (message: string) => void = () => {};

export function setCloudErrorReporter(report: (message: string) => void): void {
  reportError = report;
}

/** Coalesce rapid autosaves so only the newest snapshot is uploaded. */
export function queueWorldSave(id: string, snapshot: SavedSimulation): void {
  latest = { id, snapshot };
  if (!draining) void drain();
}

async function drain(): Promise<void> {
  draining = true;
  try {
    while (latest) {
      const job = latest;
      latest = null;
      try {
        await saveWorld(job.id, job.snapshot);
      } catch (err) {
        reportError(err instanceof Error ? err.message : 'Cloud save failed');
      }
    }
  } finally {
    draining = false;
    if (latest) void drain();
  }
}
