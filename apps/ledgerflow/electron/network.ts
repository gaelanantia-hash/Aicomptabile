import { execFile } from 'node:child_process'

// Windows' own view of the current connection: set automatically for phone hotspots, or by the user in Wi-Fi settings ("metered connection").
const script = [
  '[void][Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime]',
  '$c = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile().GetConnectionCost()',
  '"$($c.NetworkCostType)|$($c.Roaming)|$($c.ApproachingDataLimit)|$($c.OverDataLimit)"',
].join('; ')

/** Paid by volume, roaming, or near its data limit. Unknown or unreadable answers count as not metered, as before this check existed. */
export function parseConnectionCost(output: string) {
  const [cost, ...flags] = output.trim().split('|')
  return cost === 'Fixed' || cost === 'Variable' || flags.some((flag) => flag === 'True')
}

export function isMeteredConnection(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 10_000, windowsHide: true }, (error, stdout) => {
      resolve(!error && parseConnectionCost(stdout))
    })
  })
}
