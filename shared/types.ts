/** A song container. Legacy API/storage calls these "groups". */
export interface SongGroup {
  id: string
  name: string
  color: string
  createdAt: string
  updatedAt: string
  notes: string
}

/** An audio version attached to a song. Legacy API/storage calls these "songs". */
export interface Recording {
  id: string
  title: string
  originalName: string
  mimeType: string
  size: number
  duration: number
  groupId: string | null
  notes: string
  bpm: number | null
  createdAt: string
  updatedAt: string
  loopCount: number
}

export type Group = SongGroup
export type Song = Recording

export interface Loop {
  id: string
  songId: string
  name: string
  start: number
  end: number
  createdAt: string
}

export interface Library {
  songs: Song[]
  groups: Group[]
}

export const GROUP_COLORS = ['#e57947', '#789978', '#8b82b5', '#729eab', '#c49c4b', '#c77c92'] as const
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024
