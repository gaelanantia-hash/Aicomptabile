<#
.SYNOPSIS
  Lets the GitHub release workflow (.github/workflows/release.yml) publish installers to the developer's Google Cloud project:
  release bucket, deploy service account, and Workload Identity Federation between the repository and Google Cloud.

.DESCRIPTION
  Safe to run again: every step first checks whether its resource already exists.
  No key file is created: GitHub proves who it is to Google Cloud for each run, and only workflows of this repository are accepted.

  At the end it sets the repository variables the workflow reads (with the GitHub CLI `gh`, when installed and signed in),
  or prints them to paste into GitHub -> Settings -> Secrets and variables -> Actions.
  The OAuth client and the trial end date are taken from apps/ledgerflow/desktop.config.json.

  Requirements: Google Cloud CLI (https://cloud.google.com/sdk/docs/install) with `gcloud auth login` done.
  Optional: GitHub CLI (https://cli.github.com) with `gh auth login` done.

.EXAMPLE
  pwsh scripts/setup-github-release.ps1 -ProjectId aicom-prod
#>
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [string]$Region = 'europe-west8',
  # United States regions are inside Cloud Storage's Always Free tier (about 5 GB stored and 100 GB downloaded a month).
  [string]$BucketLocation = 'us-central1',
  # owner/name on GitHub; read from the git remote when left out.
  [string]$Repo
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$configFile = Join-Path $root 'apps/ledgerflow/desktop.config.json'
$bucket = "$ProjectId-aicom-releases"
$serviceAccount = "aicom-deploy@$ProjectId.iam.gserviceaccount.com"
$pool = 'github'
$provider = 'aicom-repo'

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Invoke-Gcloud { & gcloud @args; if ($LASTEXITCODE) { throw "gcloud $($args -join ' ') failed." } }
function Test-Gcloud { & gcloud @args *> $null; return $LASTEXITCODE -eq 0 }
# A service account just created takes a little while to be visible to other services: retry before giving up.
function Invoke-GcloudRetry {
  for ($attempt = 1; $attempt -le 12; $attempt++) {
    & gcloud @args 2>$null | Out-Null
    if (-not $LASTEXITCODE) { return }
    Write-Host "  not ready yet, retrying in 10 s ($attempt/12)"
    Start-Sleep -Seconds 10
  }
  throw "gcloud $($args -join ' ') failed."
}

Step 'Checking tools'
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { throw 'Google Cloud CLI not found. Install it from https://cloud.google.com/sdk/docs/install and run: gcloud auth login' }
$account = & gcloud auth list --filter=status:ACTIVE --format='value(account)'
if (-not $account) { throw 'No Google account signed in. Run: gcloud auth login' }
Write-Host "Signed in as $account"
if (-not $Repo) {
  $remote = & git -C $root remote get-url origin
  if ($remote -notmatch 'github\.com[:/](.+?/.+?)(\.git)?$') { throw "Cannot read the GitHub repository from the git remote ($remote). Pass -Repo owner/name." }
  $Repo = $Matches[1]
}
Write-Host "Repository $Repo"

Step "Project $ProjectId"
if (-not (Test-Gcloud projects describe $ProjectId)) { throw "Project $ProjectId not found, or this account cannot see it. Check the ID at https://console.cloud.google.com" }
Invoke-Gcloud config set project $ProjectId
$projectNumber = & gcloud projects describe $ProjectId --format='value(projectNumber)'
if ((& gcloud billing projects describe $ProjectId --format='value(billingEnabled)') -ne 'True') {
  throw "Billing is not linked to this project (Cloud Storage needs it). Link it at https://console.cloud.google.com/billing/linkedaccount?project=$ProjectId then run this script again."
}

Step 'Enabling APIs'
Invoke-Gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com storage.googleapis.com

Step "Bucket gs://$bucket"
if (-not (Test-Gcloud storage buckets describe "gs://$bucket")) {
  Invoke-Gcloud storage buckets create "gs://$bucket" --location=$BucketLocation --uniform-bucket-level-access
  # Public read: it only ever holds the installer and the update feed, which customers fetch without signing in.
  Invoke-Gcloud storage buckets add-iam-policy-binding "gs://$bucket" --member=allUsers --role=roles/storage.objectViewer | Out-Null
} else { Write-Host 'Already there.' }

Step 'Deploy service account'
if (-not (Test-Gcloud iam service-accounts describe $serviceAccount)) { Invoke-Gcloud iam service-accounts create aicom-deploy --display-name='AICOM release (GitHub Actions)' }
# Object admin on this bucket only: the workflow replaces latest.yml at each release, which needs delete as well as create.
Invoke-GcloudRetry storage buckets add-iam-policy-binding "gs://$bucket" --member="serviceAccount:$serviceAccount" --role=roles/storage.objectAdmin

Step 'Workload Identity Federation (GitHub -> Google Cloud, no key file)'
if (-not (Test-Gcloud iam workload-identity-pools describe $pool --location=global)) {
  Invoke-Gcloud iam workload-identity-pools create $pool --location=global --display-name='GitHub Actions'
}
if (-not (Test-Gcloud iam workload-identity-pools providers describe $provider --location=global --workload-identity-pool=$pool)) {
  # Only tokens issued for this repository are accepted.
  Invoke-Gcloud iam workload-identity-pools providers create-oidc $provider --location=global --workload-identity-pool=$pool `
    --display-name='AICOM repository' --issuer-uri='https://token.actions.githubusercontent.com' `
    --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' `
    --attribute-condition="assertion.repository=='$Repo'"
}
$principal = "principalSet://iam.googleapis.com/projects/$projectNumber/locations/global/workloadIdentityPools/$pool/attribute.repository/$Repo"
Invoke-GcloudRetry iam service-accounts add-iam-policy-binding $serviceAccount --role=roles/iam.workloadIdentityUser --member=$principal --quiet
$providerName = "projects/$projectNumber/locations/global/workloadIdentityPools/$pool/providers/$provider"

Step 'Local desktop.config.json'
$config = if (Test-Path $configFile) { Get-Content $configFile -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
# Builds made on this PC then update themselves from the same bucket as the published ones.
$config.updateFeedUrl = "https://storage.googleapis.com/$bucket/releases"
$config | ConvertTo-Json | Set-Content $configFile
Write-Host "updateFeedUrl = $($config.updateFeedUrl)"

$variables = [ordered]@{
  RELEASE_BUCKET = $bucket
  GCP_REGION = $Region
  GCP_WORKLOAD_IDENTITY_PROVIDER = $providerName
  GCP_DEPLOY_SERVICE_ACCOUNT = $serviceAccount
  GOOGLE_OAUTH_CLIENT_ID = [string]$config.googleClientId
  TRIAL_UNTIL = [string]$config.trialUntil
}
$clientSecret = [string]$config.googleClientSecret

Step 'GitHub repository settings'
$ghReady = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
  & gh auth status *> $null
  $ghReady = $LASTEXITCODE -eq 0
}
if ($ghReady) {
  foreach ($name in $variables.Keys) {
    if (-not $variables[$name]) { Write-Host "  $name is empty in desktop.config.json: left unset." -ForegroundColor Yellow; continue }
    & gh variable set $name --repo $Repo --body $variables[$name]; if ($LASTEXITCODE) { throw "gh variable set $name failed." }
  }
  if ($clientSecret) {
    # Read from standard input, so the secret never appears on a command line.
    $clientSecret | & gh secret set GOOGLE_OAUTH_CLIENT_SECRET --repo $Repo; if ($LASTEXITCODE) { throw 'gh secret set GOOGLE_OAUTH_CLIENT_SECRET failed.' }
  }
  Write-Host 'Variables and secret set on GitHub.' -ForegroundColor Green
} else {
  Write-Host "GitHub CLI not available or not signed in. In https://github.com/$Repo/settings/variables/actions create these variables:" -ForegroundColor Yellow
  foreach ($name in $variables.Keys) { Write-Host ("  {0,-32} {1}" -f $name, $(if ($variables[$name]) { $variables[$name] } else { '(empty in desktop.config.json: fill in by hand)' })) }
  Write-Host "and in https://github.com/$Repo/settings/secrets/actions this secret:" -ForegroundColor Yellow
  Write-Host "  GOOGLE_OAUTH_CLIENT_SECRET       the value of googleClientSecret in $configFile"
}

Write-Host "`nDone. Publish a version with a tag, for example:  git tag v0.2.7; git push origin v0.2.7" -ForegroundColor Green
Write-Host "Download link for customers afterwards:  https://storage.googleapis.com/$bucket/releases/AICOM-Setup-<version>.exe"
Write-Host 'The licensing service is deployed by the workflow only once LICENSE_SERVER_URL is set (see scripts/setup-google-cloud.ps1).'
