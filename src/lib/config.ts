import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CONFIG_FILE = path.join(os.homedir(), '.config', 'yoinks', 'config.json')

export type Config = {
  /** videos land in <videoDir>/<platform>/ */
  videoDir: string
  /** songs land in <musicDir>/<artist>/ */
  musicDir: string
}

const DEFAULTS: Config = {
  videoDir: path.join(os.homedir(), 'Downloads', 'yoinks'),
  musicDir: path.join(os.homedir(), 'Music'),
}

export function loadConfig(): Config {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    const saved = typeof parsed === 'object' && parsed ? (parsed as Partial<Config>) : {}
    return {
      videoDir: typeof saved.videoDir === 'string' ? saved.videoDir : DEFAULTS.videoDir,
      musicDir: typeof saved.musicDir === 'string' ? saved.musicDir : DEFAULTS.musicDir,
    }
  } catch {
    return {...DEFAULTS}
  }
}

/** Merge and persist. Returns the new config. */
export function saveConfig(patch: Partial<Config>): Config {
  const next = {...loadConfig(), ...patch}
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), {recursive: true})
    fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`)
  } catch {
    // settings are a nicety — never let them break a download
  }
  return next
}
