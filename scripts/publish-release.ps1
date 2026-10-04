<#
.SYNOPSIS
  Builds the AICOM installer and publishes it to the Google Cloud Storage bucket the installed apps update from.

.DESCRIPTION
  1. Checks gcloud and the bucket (creates it, publicly readable, if it does not exist yet).
  2. Makes sure apps/ledgerflow/desktop.config.json points updateFeedUrl at this bucket.
  3. Runs the tests and builds the installer (npm run dist).
  4. Uploads the installer and its blockmap, then a fixed "latest" copy for new customers,
     and latest.yml last: installed apps only see the new version once every file it needs is in place.

  The version is the one in apps/ledgerflow/package.json; raise it before publishing, or installed apps will not update.
  Without a code-signing certificate the installer is unsigned: Windows SmartScreen warns on the first manual install,
  updates installed by the app itself are not affected.

  Requirements: Google Cloud CLI (https://cloud.google.com/sdk/docs/install) with `gcloud auth login` done, Node.js.

.EXAMPLE
  pwsh scripts/publish-release.ps1 -Bucket aicom-prod-aicom-releases
#>
param(
  [Parameter(Mandatory)][string]$Bucket,
  [string]$Region = 'europe-west8'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$app = Join-Path $root 'apps/ledgerflow'
$configFile = Join-Path $app 'desktop.config.json'
$feed = "https://storage.googleapis.com/$Bucket/releases"

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Invoke-Checked { & $args[0] @($args | Select-Object -Skip 1); if ($LASTEXITCODE) { throw "$($args -join ' ') failed." } }

Step 'Checking tools'
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'Google Cloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install and run: gcloud auth login' }
if (-not (& gcloud auth list --filter=status:ACTIVE --format='value(account)')) { throw 'No Google account signed in. Run: gcloud auth login' }

Step "Bucket gs://$Bucket"
& gcloud storage buckets describe "gs://$Bucket" *> $null
if ($LASTEXITCODE) {
  Invoke-Checked gcloud storage buckets create "gs://$Bucket" --location=$Region --uniform-bucket-level-access
  # Public read: it only ever holds the installer and the update feed, which customers fetch without signing in.
  Invoke-Checked gcloud storage buckets add-iam-policy-binding "gs://$Bucket" --member=allUsers --role=roles/storage.objectViewer
}

Step 'Update feed in desktop.config.json'
if (-not (Test-Path $configFile)) { throw "Missing $configFile. Copy desktop.config.example.json and fill it in first." }
$config = Get-Content $configFile -Raw | ConvertFrom-Json -AsHashtable
if ($config.updateFeedUrl -ne $feed) {
  $config.updateFeedUrl = $feed
  $config | ConvertTo-Json | Set-Content $configFile
  Write-Host "updateFeedUrl set to $feed"
}
$version = (Get-Content (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "Version $version · trial until: $(if ($config.trialUntil) { $config.trialUntil } else { 'none (licensed build)' })"

Step 'Tests and installer (a few minutes)'
Push-Location $app
try {
  Invoke-Checked npm test
  Invoke-Checked npm run dist
} finally { Pop-Location }

$release = Join-Path $app 'release'
$installer = Join-Path $release "AICOM-Setup-$version.exe"
foreach ($file in @($installer, "$installer.blockmap", (Join-Path $release 'latest.yml'))) {
  if (-not (Test-Path $file)) { throw "Expected $file after the build." }
}

Step 'Uploading'
Invoke-Checked gcloud storage cp $installer "$installer.blockmap" "gs://$Bucket/releases/"
Invoke-Checked gcloud storage cp $installer "gs://$Bucket/releases/AICOM-Setup-latest.exe" --cache-control='no-cache'
# Last, and never cached: the file installed apps poll to learn that a new version exists.
Invoke-Checked gcloud storage cp (Join-Path $release 'latest.yml') "gs://$Bucket/releases/latest.yml" --cache-control='no-cache'

Write-Host "`nPublished AICOM $version." -ForegroundColor Green
Write-Host "  Installed apps (0.2.0 and later) update at their next start."
Write-Host "  Download link for new customers: $feed/AICOM-Setup-latest.exe"
