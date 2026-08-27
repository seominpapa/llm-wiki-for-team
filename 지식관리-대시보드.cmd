@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"
if errorlevel 1 (
  echo 프로젝트 폴더로 이동할 수 없습니다. 1>&2
  exit /b 1
)

where node >nul 2>&1
if not errorlevel 1 goto node_ready

echo Node.js가 없어 설치를 시작합니다.
where winget >nul 2>&1
if errorlevel 1 goto install_official_node

winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo winget으로 Node.js를 설치하지 못했습니다. 설치가 거부되었거나 실패했습니다. 1>&2
  exit /b 1
)
goto verify_node

:install_official_node
powershell -NoProfile -ExecutionPolicy Bypass -Command "$msi = $null; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'; $release = $null; foreach ($candidate in $releases) { if ($candidate.lts) { $release = $candidate; break } }; if (-not $release -or $release.version -notmatch '^v\d+\.\d+\.\d+$') { throw 'LTS 버전을 확인하지 못했습니다.' }; $machineArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }; $arch = if ($machineArchitecture -eq 'ARM64') { 'arm64' } elseif ($machineArchitecture -eq 'AMD64') { 'x64' } else { throw ('지원하지 않는 Windows 아키텍처입니다: ' + $machineArchitecture) }; $msi = Join-Path ([IO.Path]::GetTempPath()) ('node-' + [guid]::NewGuid().ToString('N') + '.msi'); $uri = 'https://nodejs.org/dist/' + $release.version + '/node-' + $release.version + '-' + $arch + '.msi'; Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $msi; $signature = Get-AuthenticodeSignature $msi; if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(OpenJS Foundation|Node.js Foundation)') { throw '공식 설치 패키지 서명을 확인하지 못했습니다.' }; $process = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', $msi, '/passive', '/norestart') -Verb RunAs -Wait -PassThru; if ($process.ExitCode -notin @(0, 1641, 3010)) { throw ('설치 프로그램 종료 코드: ' + $process.ExitCode) } } catch { Write-Error ('Node.js 설치가 거부되었거나 실패했습니다: ' + $_.Exception.Message); exit 1 } finally { if ($msi -and (Test-Path $msi)) { Remove-Item -Force $msi } }"
if errorlevel 1 exit /b 1

:verify_node
set "PATH=%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%LocalAppData%\Programs\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 설치 후 실행 파일을 찾지 못했습니다. 명령 프롬프트를 다시 연 뒤 시도해 주세요. 1>&2
  exit /b 1
)

:node_ready

node scripts\build-wiki-graph.mjs
if errorlevel 1 (
  echo 지식 그래프와 대시보드 생성에 실패했습니다. 1>&2
  exit /b 1
)

set "PORT=8766"
set "BASE_URL=http://127.0.0.1:8766"
:select_server
set "BASE_URL=http://127.0.0.1:%PORT%"
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%BASE_URL%/api/health' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 goto server_ready
powershell -NoProfile -Command "if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { exit 2 }; if (Get-NetTCPConnection -State Listen -LocalPort %PORT% -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 2 goto check_port_with_netstat
if errorlevel 1 goto start_server
goto port_occupied

:check_port_with_netstat
netstat -ano -p tcp | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 goto start_server

:port_occupied
set /a PORT+=1
if %PORT% GTR 8775 (
  echo 8766~8775 포트가 모두 사용 중이라 대시보드 서버를 시작하지 못했습니다. 1>&2
  exit /b 1
)
goto select_server

:start_server
set "ONTOLOGY_EDITOR_PORT=%PORT%"
start "" /b node scripts\serve-ontology-editor.mjs
set "ONTOLOGY_EDITOR_PORT="

set "ATTEMPT=0"
:wait_for_server
powershell -NoProfile -Command "try { $response = Invoke-WebRequest -UseBasicParsing -Uri '%BASE_URL%/dashboard' -TimeoutSec 1; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; exit 1"
if not errorlevel 1 goto server_ready
set /a ATTEMPT+=1
if %ATTEMPT% GEQ 50 (
  echo 대시보드 서버가 준비되지 않았습니다. 1>&2
  exit /b 1
)
powershell -NoProfile -Command "Start-Sleep -Milliseconds 200"
goto wait_for_server

:server_ready
if "%PORT%"=="8766" (
  start "" "http://127.0.0.1:8766/dashboard"
) else (
  start "" "%BASE_URL%/dashboard"
)
