param(
  [Parameter(Mandatory = $true)]
  [string]$RootPath
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RootPath)) {
  throw "A Provi root path is required."
}

$currentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$icacls = Join-Path $env:SystemRoot "System32\icacls.exe"

New-Item -ItemType Directory -Force -Path $RootPath | Out-Null

& $icacls $RootPath `
  "/grant:r" `
  "*$($currentUserSid):(OI)(CI)F" `
  "*S-1-5-18:(OI)(CI)F" `
  "*S-1-5-32-544:(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not grant the private Provi folder permissions."
}

& $icacls $RootPath "/inheritancelevel:r" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not disable inherited permissions on the private Provi folder."
}

& $icacls $RootPath `
  "/remove:g" `
  "*S-1-1-0" `
  "*S-1-5-11" `
  "*S-1-5-32-545" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not remove broad access from the private Provi folder."
}

$children = Get-ChildItem -LiteralPath $RootPath -Force -ErrorAction SilentlyContinue
if ($children) {
  & $icacls (Join-Path $RootPath "*") "/reset" "/T" "/C" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not apply the private Provi permissions to existing files."
  }
}

Write-Output "Private Provi NTFS permissions are active for $currentUserSid."
