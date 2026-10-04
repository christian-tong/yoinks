import {isThemeMode, type ThemeMode} from '../theme.js'

export type CliArgs = {
  help: boolean
  version: boolean
  /** urls or file paths, in order — cli.tsx expands files */
  inputs: string[]
  themeMode?: ThemeMode
  error?: string
}

export function parseArgs(args: string[]): CliArgs {
  const result: CliArgs = {help: false, version: false, inputs: []}

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (arg === '-h' || arg === '--help') {
      result.help = true
    } else if (arg === '-v' || arg === '--version') {
      result.version = true
    } else if (arg === '--theme') {
      const value = args[++index]
      if (!value) return {...result, error: '--theme needs a value: auto, light, or dark'}
      if (!isThemeMode(value)) return {...result, error: `unknown theme “${value}” — use auto, light, or dark`}
      result.themeMode = value
    } else if (arg.startsWith('--theme=')) {
      const value = arg.slice('--theme='.length)
      if (!isThemeMode(value)) return {...result, error: `unknown theme “${value}” — use auto, light, or dark`}
      result.themeMode = value
    } else if (arg.startsWith('-')) {
      return {...result, error: `unknown option “${arg}”`}
    } else {
      result.inputs.push(arg)
    }
  }

  return result
}
