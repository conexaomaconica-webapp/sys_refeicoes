[CmdletBinding()]
param(
    [int]$Port = 55443
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.IO.Compression.FileSystem

$expectedUrl = 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip'
$expectedSize = 381531864L
$expectedSha256 = '80379B2C04D51C30225532E0AE04509899141E9957ED096FE749D7FD9DF8F82F'

$freeBytes = [int64]([System.IO.DriveInfo]::new('C').AvailableFreeSpace)
$freeGb = [math]::Round($freeBytes / 1GB, 2)
Write-Output ("Disk C free before start: {0} GB ({1} bytes)" -f $freeGb, $freeBytes)

if ($freeBytes -lt 786432000L) {
    throw "Espaco insuficiente em C: ($freeGb GB). Minimo seguro exigido: 0.75 GB."
}

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw "Porta local $Port ja esta em uso."
}

$guid = [Guid]::NewGuid().ToString('N')
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\', '/')
$zipPath = Join-Path $tempBase ("ma-sprint20-pg1711-$guid.zip")
$extractRoot = Join-Path $tempBase ("ma-sprint20-tools-$guid")
$instanceRoot = Join-Path $tempBase ("ma-sprint20-pg-$guid")
$dataDirectory = Join-Path $instanceRoot 'data'
$passwordFile = Join-Path $instanceRoot 'pwfile'
$serverLog = Join-Path $instanceRoot 'postgres.log'
$databaseName = 'sprint20_83_' + [Guid]::NewGuid().ToString('N')

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$runner = Join-Path $root 'scripts\homologate-sprint20-migration83.cjs'
$node = Get-Command node -ErrorAction Stop
$evidenceRoot = Join-Path $root 'docs\evidence\sprint20'
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceLog = Join-Path $evidenceRoot "sprint20-migration83-$timestamp.log"
$evidenceJson = Join-Path $evidenceRoot "sprint20-migration83-$timestamp.json"

$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$password = ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
$pgBin = Join-Path $extractRoot 'pgsql\bin'

try {
    Write-Output "Downloading PostgreSQL 17.11-5 binaries from official EDB endpoint..."
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $expectedUrl -OutFile $zipPath -UseBasicParsing

    $actualSize = (Get-Item -LiteralPath $zipPath).Length
    if ($actualSize -ne $expectedSize) {
        throw "Tamanho divergente do ZIP: esperado $expectedSize, obtido $actualSize."
    }

    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedSha256) {
        throw "SHA-256 divergente! Esperado $expectedSha256, obtido $actualHash."
    }
    Write-Output ("ZIP verified: size={0} bytes, sha256={1}" -f $actualSize, $actualHash)

    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    $extractPrefix = ([System.IO.Path]::GetFullPath($extractRoot).TrimEnd('\', '/')) + [System.IO.Path]::DirectorySeparatorChar

    Write-Output "Extracting pgsql/bin, pgsql/lib and pgsql/share selectively..."
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        foreach ($entry in $archive.Entries) {
            if ([string]::IsNullOrEmpty($entry.Name)) { continue }
            $normEntry = $entry.FullName.Replace('\', '/')
            $keepEntry =
                ($normEntry.StartsWith('pgsql/bin/') -and ($normEntry.EndsWith('.dll') -or $normEntry -in @('pgsql/bin/postgres.exe','pgsql/bin/initdb.exe','pgsql/bin/pg_ctl.exe','pgsql/bin/createdb.exe'))) -or
                ($normEntry.StartsWith('pgsql/lib/') -and $normEntry.EndsWith('.dll') -and -not $normEntry.StartsWith('pgsql/lib/pgxs/')) -or
                ($normEntry.StartsWith('pgsql/share/') -and (
                    $normEntry -match '^pgsql/share/[^/]+$' -or
                    $normEntry.StartsWith('pgsql/share/timezone/') -or
                    $normEntry.StartsWith('pgsql/share/timezonesets/') -or
                    $normEntry.StartsWith('pgsql/share/tsearch_data/') -or
                    $normEntry -match '^pgsql/share/extension/(pgcrypto|plpgsql)'
                ))
            if (-not $keepEntry) {
                continue
            }
            $destPath = [System.IO.Path]::GetFullPath((Join-Path $extractRoot $entry.FullName))
            if (-not $destPath.StartsWith($extractPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                throw "Zip Slip bloqueado: $($entry.FullName)"
            }
            $destDir = Split-Path -Parent $destPath
            if (-not (Test-Path -LiteralPath $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destPath, $true)
        }
    }
    finally {
        $archive.Dispose()
    }

    Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path $instanceRoot -Force | Out-Null
    Set-Content -LiteralPath $passwordFile -Value $password -Encoding ASCII -NoNewline

    $initdb = Join-Path $pgBin 'initdb.exe'
    $pgCtl = Join-Path $pgBin 'pg_ctl.exe'
    $createdb = Join-Path $pgBin 'createdb.exe'

    & $initdb -D $dataDirectory -U sprint20_owner -A scram-sha-256 "--pwfile=$passwordFile" --encoding=UTF8 --no-locale
    if ($LASTEXITCODE -ne 0) { throw "initdb falhou com codigo $LASTEXITCODE." }

    Add-Content -LiteralPath (Join-Path $dataDirectory 'postgresql.conf') -Encoding ASCII -Value @(
        "listen_addresses = '127.0.0.1'",
        "port = $Port",
        "ssl = off",
        "max_connections = 20"
    )
    Set-Content -LiteralPath (Join-Path $dataDirectory 'pg_hba.conf') -Encoding ASCII -Value @(
        'host all all 127.0.0.1/32 scram-sha-256',
        'host all all 0.0.0.0/0 reject',
        'host all all ::0/0 reject'
    )

    & $pgCtl -D $dataDirectory -l $serverLog -o "-p $Port -h 127.0.0.1" -w -t 30 start
    if ($LASTEXITCODE -ne 0) { throw "pg_ctl start falhou com codigo $LASTEXITCODE." }

    $env:PGPASSWORD = $password
    & $createdb -h 127.0.0.1 -p $Port -U sprint20_owner $databaseName
    if ($LASTEXITCODE -ne 0) { throw "createdb falhou com codigo $LASTEXITCODE." }

    $env:DISPOSABLE_PG_URL = "postgresql://sprint20_owner:$password@127.0.0.1:$Port/$databaseName"
    $env:SPRINT20_EXPECTED_DATA_DIR = $dataDirectory
    $env:SPRINT20_EXPECTED_PORT = "$Port"
    $env:SPRINT20_EVIDENCE_JSON = $evidenceJson

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & $node.Source $runner 2>&1
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEap
    $sanitized = (($output | ForEach-Object { "$_" }) -join [Environment]::NewLine).Replace($password, '[REDACTED]')
    $sanitized | Set-Content -LiteralPath $evidenceLog -Encoding UTF8
    $sanitized | Write-Output

    if ($exitCode -ne 0) {
        throw "Homologacao Migration 83 falhou com codigo $exitCode."
    }
}
finally {
    Remove-Item Env:DISPOSABLE_PG_URL, Env:SPRINT20_EXPECTED_DATA_DIR, Env:SPRINT20_EXPECTED_PORT, Env:SPRINT20_EVIDENCE_JSON, Env:PGPASSWORD -ErrorAction SilentlyContinue
    $password = $null

    if ((Test-Path -LiteralPath (Join-Path $pgBin 'pg_ctl.exe')) -and (Test-Path -LiteralPath $dataDirectory)) {
        & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDirectory status *> $null
        if ($LASTEXITCODE -eq 0) {
            & (Join-Path $pgBin 'pg_ctl.exe') -D $dataDirectory -m immediate -w -t 30 stop
        }
    }
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $instanceRoot) { Remove-Item -LiteralPath $instanceRoot -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $extractRoot) { Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
