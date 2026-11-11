[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PostgresBin,

    [ValidateRange(1024, 65535)]
    [int]$Port = 55442,

    [string]$EvidenceDirectory = ''
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$runner = Join-Path $root 'scripts\homologate-sprint18-performance.cjs'
$node = Get-Command node -ErrorAction Stop

function Get-NormalizedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Test-SafeInstancePath {
    param(
        [Parameter(Mandatory = $true)][string]$Candidate,
        [Parameter(Mandatory = $true)][string]$TempBase,
        [Parameter(Mandatory = $true)][string]$RunId
    )

    $normalizedCandidate = Get-NormalizedPath $Candidate
    $normalizedBase = Get-NormalizedPath $TempBase
    $expectedPrefix = $normalizedBase + [System.IO.Path]::DirectorySeparatorChar
    $leaf = Split-Path -Leaf $normalizedCandidate

    return $normalizedCandidate.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase) `
        -and $leaf -eq $RunId `
        -and $leaf.StartsWith('ma-sprint18-', [System.StringComparison]::Ordinal)
}

$resolvedBin = Resolve-Path -LiteralPath $PostgresBin -ErrorAction Stop
if (-not (Test-Path -LiteralPath $resolvedBin -PathType Container)) {
    throw 'PostgresBin deve apontar para um diretorio existente.'
}

$required = @('postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'pg_isready.exe', 'createdb.exe', 'psql.exe')
$tools = @{}
foreach ($executable in $required) {
    $candidate = Join-Path $resolvedBin $executable
    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Binario PostgreSQL obrigatorio ausente: $executable"
    }
    $tools[$executable] = $candidate
}

$versionOutput = & $tools['postgres.exe'] --version 2>&1
if ($LASTEXITCODE -ne 0 -or "$versionOutput" -notmatch 'PostgreSQL\) 17\.') {
    throw "Versao PostgreSQL recusada: $versionOutput"
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Porta local $Port ja esta em uso. Nenhum servidor foi iniciado."
}

$runId = 'ma-sprint18-' + [Guid]::NewGuid().ToString('N')
$databaseName = 'sprint18_' + [Guid]::NewGuid().ToString('N')
$tempBase = Get-NormalizedPath ([System.IO.Path]::GetTempPath())
$instanceRoot = Join-Path $tempBase $runId
$dataDirectory = Join-Path $instanceRoot 'data'
$markerPath = Join-Path $instanceRoot '.sprint18-disposable'
$passwordFile = Join-Path $instanceRoot 'pwfile'
$serverLog = Join-Path $instanceRoot 'postgres.log'
$cleanupAllowed = $true

if (-not (Test-SafeInstancePath -Candidate $instanceRoot -TempBase $tempBase -RunId $runId)) {
    throw "Diretorio temporario recusado: $instanceRoot"
}

if ([string]::IsNullOrWhiteSpace($EvidenceDirectory)) {
    $EvidenceDirectory = Join-Path $root 'docs\evidence\sprint18'
}
$evidenceRoot = Get-NormalizedPath $EvidenceDirectory
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceLog = Join-Path $evidenceRoot "sprint18-performance-$timestamp.log"
$evidenceJson = Join-Path $evidenceRoot "sprint18-performance-$timestamp.json"

$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$password = ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()

try {
    New-Item -ItemType Directory -Path $instanceRoot -ErrorAction Stop | Out-Null
    Set-Content -LiteralPath $markerPath -Value $runId -Encoding ASCII -NoNewline
    Set-Content -LiteralPath $passwordFile -Value $password -Encoding ASCII -NoNewline

    & $tools['initdb.exe'] -D $dataDirectory -U sprint18_owner -A scram-sha-256 "--pwfile=$passwordFile" --encoding=UTF8 --no-locale
    if ($LASTEXITCODE -ne 0) {
        throw "initdb falhou com codigo $LASTEXITCODE."
    }

    Add-Content -LiteralPath (Join-Path $dataDirectory 'postgresql.conf') -Encoding ASCII -Value @(
        "listen_addresses = '127.0.0.1'",
        "port = $Port",
        "ssl = off",
        "max_connections = 32"
    )
    Set-Content -LiteralPath (Join-Path $dataDirectory 'pg_hba.conf') -Encoding ASCII -Value @(
        'host all all 127.0.0.1/32 scram-sha-256',
        'host all all 0.0.0.0/0 reject',
        'host all all ::0/0 reject'
    )

    & $tools['pg_ctl.exe'] -D $dataDirectory -l $serverLog -o "-p $Port -h 127.0.0.1" -w -t 30 start
    if ($LASTEXITCODE -ne 0) {
        throw "pg_ctl start falhou com codigo $LASTEXITCODE."
    }

    $env:PGPASSWORD = $password
    & $tools['createdb.exe'] -h 127.0.0.1 -p $Port -U sprint18_owner $databaseName
    if ($LASTEXITCODE -ne 0) {
        throw "createdb falhou com codigo $LASTEXITCODE."
    }

    $env:DISPOSABLE_PG_URL = "postgresql://sprint18_owner:$password@127.0.0.1:$Port/$databaseName"
    $env:SPRINT18_EXPECTED_DATA_DIR = $dataDirectory
    $env:SPRINT18_EXPECTED_PORT = "$Port"
    $env:SPRINT18_EVIDENCE_JSON = $evidenceJson

    New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $node.Source $runner 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    $sanitized = (($output | ForEach-Object { "$_" }) -join [Environment]::NewLine).Replace($password, '[REDACTED]')
    $sanitized | Set-Content -LiteralPath $evidenceLog -Encoding UTF8
    $sanitized | Write-Output

    if ($exitCode -ne 0) {
        throw "Runner Sprint 18 falhou com codigo $exitCode."
    }
}
finally {
    Remove-Item Env:DISPOSABLE_PG_URL, Env:SPRINT18_EXPECTED_DATA_DIR, Env:SPRINT18_EXPECTED_PORT, Env:SPRINT18_EVIDENCE_JSON, Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null

    if (Test-Path -LiteralPath $dataDirectory) {
        & $tools['pg_ctl.exe'] -D $dataDirectory status *> $null
        if ($LASTEXITCODE -eq 0) {
            & $tools['pg_ctl.exe'] -D $dataDirectory -m immediate -w -t 30 stop
            if ($LASTEXITCODE -ne 0) {
                $cleanupAllowed = $false
                Write-Error 'PostgreSQL nao encerrou; diretorio preservado.'
            }
        }
    }

    for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }

    if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
        $cleanupAllowed = $false
        Write-Error "Porta $Port continua ocupada."
    }

    $markerMatches = (Test-Path -LiteralPath $markerPath -PathType Leaf) -and ((Get-Content -LiteralPath $markerPath -Raw) -eq $runId)
    if ($cleanupAllowed -and (Test-SafeInstancePath -Candidate $instanceRoot -TempBase $tempBase -RunId $runId) -and $markerMatches) {
        Remove-Item -LiteralPath $instanceRoot -Recurse -Force
    }
    elseif (Test-Path -LiteralPath $instanceRoot) {
        Write-Error "Limpeza recusada. Diretorio preservado: $instanceRoot"
    }
}

