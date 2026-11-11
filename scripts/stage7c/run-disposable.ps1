$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$compose = Join-Path $root 'infra\stage7c\compose.yaml'
$connection = 'postgresql://stage7c_owner:stage7c_local_only@127.0.0.1:55437/stage7c_security'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker nao esta disponivel. Nenhum ambiente ou banco foi alterado.'
}

try {
    docker compose -f $compose up -d --wait
    $env:STAGE7C_DB_URL = $connection
    $env:STAGE7C_EXPECTED_DATA_DIR = '/var/lib/postgresql/data'
    $env:STAGE7C_EXPECTED_PORT = '5432'
    node (Join-Path $root 'scripts\homologate-stage7c-local.cjs')
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}
finally {
    docker compose -f $compose down --volumes --remove-orphans
    Remove-Item Env:STAGE7C_DB_URL -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE7C_EXPECTED_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:STAGE7C_EXPECTED_PORT -ErrorAction SilentlyContinue
}
