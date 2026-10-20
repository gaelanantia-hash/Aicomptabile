<#
.SYNOPSIS
  Sets up the developer's Google Cloud project for AICOM: APIs, licence database, secrets, licensing service on Cloud Run,
  release bucket, and writes the resulting values into apps/ledgerflow/desktop.config.json.

.DESCRIPTION
  Safe to run again: every step first checks whether its resource already exists.
  Three things cannot be scripted and are listed at the end: linking billing, the OAuth consent screen, and the OAuth desktop client.

  Requirements: Google Cloud CLI (https://cloud.google.com/sdk/docs/install), `gcloud auth login` done, Node.js.

.EXAMPLE
  pwsh scripts/setup-google-cloud.ps1 -ProjectId aicom-prod
#>
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [string]$Region = 'europe-west8'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$licensing = Join-Path $root 'apps/licensing'
$configFile = Join-Path $root 'apps/ledgerflow/desktop.config.json'
$serviceAccount = "aicom-licensing@$ProjectId.iam.gserviceaccount.com"
$bucket = "$ProjectId-aicom-releases"

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE) { throw "gcloud $($args -join ' ') failed." } }
function Test-Gcloud { & gcloud @args *> $null; return $LASTEXITCODE -eq 0 }
function New-Secret([string]$name, [string]$value) {
  # Written through a temp file without a trailing newline: piping in PowerShell would append one and corrupt the key.
  $temp = New-TemporaryFile
  try {
    [IO.File]::WriteAllText($temp, $value)
    Invoke-Gcloud secrets create $name --data-file=$temp --replication-policy=automatic
  } finally { Remove-Item $temp -Force }
  Invoke-Gcloud secrets add-iam-policy-binding $name --member="serviceAccount:$serviceAccount" --role=roles/secretmanager.secretAccessor --quiet | Out-Null
}

Step 'Checking tools'
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'Google Cloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install and run: gcloud auth login' }
$account = & gcloud auth list --filter=status:ACTIVE --format='value(account)'
if (-not $account) { throw 'No Google account signed in. Run: gcloud auth login' }
Write-Host "Signed in as $account"

Step "Project $ProjectId"
if (-not (Test-Gcloud projects describe $ProjectId)) { Invoke-Gcloud projects create $ProjectId --name='AICOM' }
Invoke-Gcloud config set project $ProjectId
if ((& gcloud billing projects describe $ProjectId --format='value(billingEnabled)') -ne 'True') {
  throw "Billing is not linked to this project. Link it at https://console.cloud.google.com/billing/linkedaccount?project=$ProjectId then run this script again."
}

Step 'Enabling APIs'
Invoke-Gcloud services enable drive.googleapis.com run.googleapis.com firestore.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com

Step 'Licence database (Firestore)'
if (-not (Test-Gcloud firestore databases describe '--database=(default)')) { Invoke-Gcloud firestore databases create --location=$Region }

Step 'Service account for the licensing service'
if (-not (Test-Gcloud iam service-accounts describe $serviceAccount)) { Invoke-Gcloud iam service-accounts create aicom-licensing --display-name='AICOM licensing' }
Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$serviceAccount" --role=roles/datastore.user --condition=None --quiet | Out-Null

Step 'Licence signing key and admin token'
$publicKey = $null
if (Test-Gcloud secrets describe aicom-license-private-key) {
  Write-Host 'Secrets already exist: keeping them.'
  # A run interrupted after this step never wrote the public key: derive it again from the stored private key.
  $existing = if (Test-Path $configFile) { Get-Content $configFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
  if (-not $existing.licensePublicKey) {
    $privateKey = (& gcloud secrets versions access latest --secret=aicom-license-private-key) -join ''
    $publicKey = $privateKey | & node -e "let k='';process.stdin.on('data',(d)=>k+=d).on('end',()=>{const c=require('node:crypto');console.log(c.createPublicKey(c.createPrivateKey({key:Buffer.from(k.trim(),'base64'),format:'der',type:'pkcs8'})).export({format:'der',type:'spki'}).toString('base64'))})"
    if ($LASTEXITCODE -or -not $publicKey) { throw 'Could not derive the public key from the stored private key.' }
    $publicKey = $publicKey.Trim()
    Remove-Variable privateKey
  }
  if (-not (Test-Path (Join-Path $licensing '.env'))) { $adminToken = (& gcloud secrets versions access latest --secret=aicom-admin-token) -join '' }
} else {
  Push-Location $licensing
  try {
    if (-not (Test-Path node_modules)) { & npm ci; if ($LASTEXITCODE) { throw 'npm ci failed.' } }
    $generated = & node src/cli.ts keygen
  } finally { Pop-Location }
  $privateKey = ($generated | Select-String 'LICENSE_PRIVATE_KEY=(.+)$').Matches[0].Groups[1].Value.Trim()
  $adminToken = ($generated | Select-String 'ADMIN_TOKEN=(.+)$').Matches[0].Groups[1].Value.Trim()
  $publicKey = ($generated | Where-Object { $_.Trim() } | Select-Object -Last 1).Trim()
  New-Secret aicom-license-private-key $privateKey
  New-Secret aicom-admin-token $adminToken
  Write-Host 'Stored in Secret Manager. Keep a copy of the private key outside Google Cloud:' -ForegroundColor Yellow
  Write-Host '  gcloud secrets versions access latest --secret=aicom-license-private-key'
}

Step 'Build permissions'
# Projects created since 2024 build with the Compute Engine default account, which needs this role to read the uploaded sources.
$projectNumber = & gcloud projects describe $ProjectId --format='value(projectNumber)'
Invoke-Gcloud projects add-iam-policy-binding $ProjectId --member="serviceAccount:$projectNumber-compute@developer.gserviceaccount.com" --role=roles/run.builder --condition=None --quiet | Out-Null

Step 'Deploying the licensing service to Cloud Run (a few minutes)'
Invoke-Gcloud run deploy aicom-licensing --source $licensing --region $Region --allow-unauthenticated --service-account $serviceAccount `
  --set-secrets 'LICENSE_PRIVATE_KEY=aicom-license-private-key:latest,ADMIN_TOKEN=aicom-admin-token:latest' --quiet
$serviceUrl = & gcloud run services describe aicom-licensing --region $Region --format='value(status.url)'
# /health, not /healthz: Cloud Run reserves paths ending in "z".
$health = Invoke-WebRequest "$serviceUrl/health" -UseBasicParsing
if ($health.Content -ne 'ok') { throw "The service did not answer its health check at $serviceUrl/health" }
Write-Host "Service is up: $serviceUrl"

Step 'Bucket for installers and updates'
if (-not (Test-Gcloud storage buckets describe "gs://$bucket")) {
  Invoke-Gcloud storage buckets create "gs://$bucket" --location=$Region --uniform-bucket-level-access
  # Public read: it only ever holds the installer, which customers download without signing in.
  Invoke-Gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member=allUsers --role=roles/storage.objectViewer | Out-Null
}

Step 'Writing desktop.config.json and the admin settings'
$config = if (Test-Path $configFile) { Get-Content $configFile -Raw | ConvertFrom-Json -AsHashtable } else { @{ googleClientId = ''; googleClientSecret = '' } }
$config.licenseServerUrl = $serviceUrl
$config.updateFeedUrl = "https://storage.googleapis.com/$bucket/releases"
if ($publicKey) { $config.licensePublicKey = $publicKey }
$config | ConvertTo-Json | Set-Content $configFile
if ($adminToken) { Set-Content (Join-Path $licensing '.env') "ADMIN_TOKEN=$adminToken`nLICENSE_SERVER_URL=$serviceUrl" }

Write-Host "`nDone. Three steps are left, in the Google Cloud console (they cannot be scripted):" -ForegroundColor Green
Write-Host "  1. OAuth consent screen (External; scopes: openid, email, drive.file):"
Write-Host "     https://console.cloud.google.com/auth/overview?project=$ProjectId"
Write-Host "  2. Create an OAuth client of type 'Desktop app':"
Write-Host "     https://console.cloud.google.com/auth/clients?project=$ProjectId"
Write-Host "  3. Paste its client ID and secret into googleClientId / googleClientSecret in:"
Write-Host "     $configFile"
Write-Host "`nThen create a first licence:  cd apps/licensing; npm run admin -- create `"Customer name`" --devices 2"
