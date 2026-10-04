import {spawn} from 'node:child_process'

type Kind = 'file' | 'folder'

// TopMost owner form: without it the dialog can open behind the terminal.
// UTF-8 out, or a path like ~/Música comes back mangled.
const WINDOWS_SCRIPTS: Record<Kind, string> = {
  file: `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}
$dialog = New-Object System.Windows.Forms.OpenFileDialog -Property @{
  Title = 'yoinks — pick a list of links'
  Filter = 'Link lists (*.txt;*.md)|*.txt;*.md|All files (*.*)|*.*'
}
if ($dialog.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($dialog.FileName) }
`,
  folder: `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{TopMost = $true}
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog -Property @{
  Description = 'yoinks — where should downloads go?'
  ShowNewFolderButton = $true
}
if ($dialog.ShowDialog($owner) -eq 'OK') { [Console]::Out.Write($dialog.SelectedPath) }
`,
}

function commands(kind: Kind): Array<[string, string[]]> {
  if (process.platform === 'win32') {
    // -EncodedCommand sidesteps every quoting rule between node, cmd and powershell
    const encoded = Buffer.from(WINDOWS_SCRIPTS[kind], 'utf16le').toString('base64')
    return [['powershell', ['-NoProfile', '-STA', '-EncodedCommand', encoded]]]
  }
  if (process.platform === 'darwin') {
    return [['osascript', ['-e', `POSIX path of (choose ${kind})`]]]
  }
  return kind === 'file'
    ? [
        ['zenity', ['--file-selection', '--file-filter=*.txt *.md', '--file-filter=*']],
        ['kdialog', ['--getopenfilename', '.', '*.txt *.md']],
      ]
    : [
        ['zenity', ['--file-selection', '--directory']],
        ['kdialog', ['--getexistingdirectory', '.']],
      ]
}

function run(command: string, args: string[]): Promise<{missing: true} | {path?: string}> {
  return new Promise(resolve => {
    let out = ''
    const child = spawn(command, args, {stdio: ['ignore', 'pipe', 'ignore']})
    child.stdout.on('data', chunk => (out += chunk))
    child.on('error', () => resolve({missing: true}))
    // cancelling exits non-zero (osascript, zenity) or prints nothing (windows)
    child.on('close', code => resolve({path: code === 0 && out.trim() ? out.trim() : undefined}))
  })
}

/**
 * Open the system's native picker. Resolves to the chosen path, undefined if
 * the user cancelled; rejects when there's no picker to open.
 */
async function pick(kind: Kind): Promise<string | undefined> {
  for (const [command, args] of commands(kind)) {
    const result = await run(command, args)
    if (!('missing' in result)) return result.path
  }
  throw new Error('no file picker on this system — paste the path instead')
}

export const pickFile = () => pick('file')
export const pickFolder = () => pick('folder')
