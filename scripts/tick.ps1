# Runs one FNEWS news cycle with the locally linked project.
# Requires `npx tgcloud login` to have been completed in this folder.

# Keep Continue: Windows PowerShell turns native stderr (the CLI writes its
# progress there) into an error record, which would abort under 'Stop'.
$ErrorActionPreference = 'Continue'

$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'tgcloud'))) {
    throw "tgcloud folder not found under $root"
}

Push-Location $root

try {
    $tickArgs = '{ compact: true }'
    $ctx = '{ initData: { user: { id: 1709377874 } } }'

    & npx tgcloud run endpoints/tick $tickArgs --ctx $ctx
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
