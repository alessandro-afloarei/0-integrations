/** An entry is `recorded` when a real recording sits beside it (`<id>.recording.json`, `<id>.<part>.recording.json`). */
export function tierOf(id: string, recordings: readonly { file: string; synthetic: boolean }[]): 'declared' | 'recorded' {
  return recordings.some(recording => recording.file.startsWith(`${id}.`) && !recording.synthetic) ? 'recorded' : 'declared';
}
