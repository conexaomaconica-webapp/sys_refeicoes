[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$PostgresBin,
    [ValidateRange(1024, 65535)][int]$Port = 55439,
    [string]$EvidenceDirectory = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$runner = Join-Path $root 'scripts\homologate-stage8a-function-hardening.cjs'
$node = Get-Command node -ErrorAction Stop

function Get-NormalizedPath([string]$Path) { [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/') }
function Test-SafeInstancePath([string]$Candidate, [string]$TempBase, [string]$RunId) {
    $candidatePath = Get-NormalizedPath $Candidate
    $basePath = Get-NormalizedPath $TempBase
    $leaf = Split-Path -Leaf $candidatePath
    return $candidatePath.StartsWith($basePath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase) `
        -and $leaf -eq $RunId -and $leaf.StartsWith('ma-stage8a-', [System.StringComparison]::Ordinal)
}

$resolvedBin = Resolve-Path -LiteralPath $PostgresBin -ErrorAction Stop
$required = @('postgres.exe','initdb.exe','pg_ctl.exe','pg_isready.exe','createdb.exe','psql.exe')
$tools = @{}
foreach($executable in $required) {
    $candidate = Join-Path $resolvedBin $executable
    if(-not (Test-Path -LiteralPath $candidate -PathType Leaf)) { throw "Binario PostgreSQL obrigatorio ausente: $executable" }
    $tools[$executable] = $candidate
}
$version = & $tools['postgres.exe'] --version 2>&1
if($LASTEXITCODE -ne 0 -or "$version" -notmatch 'PostgreSQL\) 17\.') { throw "Versao PostgreSQL recusada: $version" }
if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Porta local $Port ja esta em uso." }

$runId = 'ma-stage8a-' + [Guid]::NewGuid().ToString('N')
$databaseName = 'stage8a_' + [Guid]::NewGuid().ToString('N')
$tempBase = Get-NormalizedPath ([System.IO.Path]::GetTempPath())
$instanceRoot = Join-Path $tempBase $runId
$dataDirectory = Join-Path $instanceRoot 'data'
$markerPath = Join-Path $instanceRoot '.stage8a-disposable'
$passwordFile = Join-Path $instanceRoot 'pwfile'
$serverLog = Join-Path $instanceRoot 'postgres.log'
$cleanupAllowed = $true
if(-not (Test-SafeInstancePath $instanceRoot $tempBase $runId)) { throw "Diretorio temporario recusado: $instanceRoot" }
if([string]::IsNullOrWhiteSpace($EvidenceDirectory)) { $EvidenceDirectory = Join-Path $root 'docs\evidence\stage8a' }
$evidenceRoot = Get-NormalizedPath $EvidenceDirectory
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceLog = Join-Path $evidenceRoot "stage8a-hardening-$timestamp.log"
$evidenceJson = Join-Path $evidenceRoot "stage8a-hardening-$timestamp.json"
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
$password = ([System.BitConverter]::ToString($bytes)).Replace('-','').ToLowerInvariant()

try {
    New-Item -ItemType Directory -Path $instanceRoot | Out-Null
    Set-Content -LiteralPath $markerPath -Value $runId -Encoding ASCII -NoNewline
    Set-Content -LiteralPath $passwordFile -Value $password -Encoding ASCII -NoNewline
    & $tools['initdb.exe'] -D $dataDirectory -U stage8a_owner -A scram-sha-256 "--pwfile=$passwordFile" --encoding=UTF8 --no-locale
    if($LASTEXITCODE -ne 0) { throw "initdb falhou com codigo $LASTEXITCODE." }
    Add-Content -LiteralPath (Join-Path $dataDirectory 'postgresql.conf') -Encoding ASCII -Value @("listen_addresses = '127.0.0.1'", "port = $Port", 'ssl = off', 'max_connections = 20')
    Set-Content -LiteralPath (Join-Path $dataDirectory 'pg_hba.conf') -Encoding ASCII -Value @('host all all 127.0.0.1/32 scram-sha-256','host all all 0.0.0.0/0 reject','host all all ::0/0 reject')
    & $tools['pg_ctl.exe'] -D $dataDirectory -l $serverLog -o "-p $Port -h 127.0.0.1" -w -t 30 start
    if($LASTEXITCODE -ne 0) { throw "pg_ctl start falhou com codigo $LASTEXITCODE." }
    $env:PGPASSWORD = $password
    & $tools['createdb.exe'] -h 127.0.0.1 -p $Port -U stage8a_owner $databaseName
    if($LASTEXITCODE -ne 0) { throw "createdb falhou com codigo $LASTEXITCODE." }
    $env:STAGE8A_DB_URL = "postgresql://stage8a_owner:$password@127.0.0.1:$Port/$databaseName"
    $env:STAGE8A_EXPECTED_DATA_DIR = $dataDirectory
    $env:STAGE8A_EXPECTED_PORT = "$Port"
    $env:STAGE8A_EVIDENCE_JSON = $evidenceJson
    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $output = & $node.Source $runner 2>&1
    $exitCode = $LASTEXITCODE
    $sanitized = ($output | Out-String).Replace($password, '[REDACTED]')
    $sanitized | Set-Content -LiteralPath $evidenceLog -Encoding UTF8
    $sanitized | Write-Output
    if($exitCode -ne 0) { throw "Runner Stage 8A.4 falhou com codigo $exitCode." }
}
finally {
    Remove-Item Env:STAGE8A_DB_URL,Env:STAGE8A_EXPECTED_DATA_DIR,Env:STAGE8A_EXPECTED_PORT,Env:STAGE8A_EVIDENCE_JSON,Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null
    if(Test-Path -LiteralPath $dataDirectory) {
        & $tools['pg_ctl.exe'] -D $dataDirectory status *> $null
        if($LASTEXITCODE -eq 0) {
            & $tools['pg_ctl.exe'] -D $dataDirectory -m immediate -w -t 30 stop
            if($LASTEXITCODE -ne 0) { $cleanupAllowed = $false; Write-Error 'PostgreSQL nao encerrou; diretorio preservado.' }
        }
    }
    for($attempt=0; $attempt -lt 20; $attempt+=1) {
        if(-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
    if(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { $cleanupAllowed = $false; Write-Error "Porta $Port continua ocupada." }
    $markerMatches = (Test-Path -LiteralPath $markerPath -PathType Leaf) -and ((Get-Content -LiteralPath $markerPath -Raw) -eq $runId)
    if($cleanupAllowed -and (Test-SafeInstancePath $instanceRoot $tempBase $runId) -and $markerMatches) { Remove-Item -LiteralPath $instanceRoot -Recurse -Force }
    elseif(Test-Path -LiteralPath $instanceRoot) { Write-Error "Limpeza recusada. Diretorio preservado: $instanceRoot" }
}

