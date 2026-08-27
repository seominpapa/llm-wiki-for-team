#!/bin/zsh
set -u

cd -- "$(dirname -- "$0")" || {
  print -u2 "프로젝트 폴더로 이동할 수 없습니다."
  exit 1
}

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print "Node.js가 없어 설치를 시작합니다."
  if command -v brew >/dev/null 2>&1; then
    if ! brew install node; then
      print -u2 "Homebrew로 Node.js를 설치하지 못했습니다. 설치가 거부되었거나 실패했습니다."
      exit 1
    fi
  else
    temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/지식관리-node.XXXXXX")" || {
      print -u2 "Node.js 설치용 임시 폴더를 만들지 못했습니다."
      exit 1
    }
    trap 'rm -rf "$temporary_directory"' EXIT
    index_file="$temporary_directory/index.json"
    if ! curl --fail --location --show-error "https://nodejs.org/dist/index.json" --output "$index_file"; then
      print -u2 "Node.js 버전 정보를 내려받지 못했습니다. 네트워크 연결을 확인해 주세요."
      exit 1
    fi
    lts_version=""
    release_index=0
    while lts_name="$(plutil -extract "$release_index.lts" raw -o - "$index_file" 2>/dev/null)"; do
      if [[ "$lts_name" != "false" ]]; then
        lts_version="$(plutil -extract "$release_index.version" raw -o - "$index_file" 2>/dev/null)"
        break
      fi
      release_index=$((release_index + 1))
    done
    if [[ ! "$lts_version" =~ '^v[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
      print -u2 "공식 목록에서 LTS Node.js 버전을 확인하지 못했습니다."
      exit 1
    fi
    package_file="$temporary_directory/node-$lts_version.pkg"
    if ! curl --fail --location --show-error "https://nodejs.org/dist/$lts_version/node-$lts_version.pkg" --output "$package_file"; then
      print -u2 "공식 Node.js 설치 패키지를 내려받지 못했습니다."
      exit 1
    fi
    if ! signature_details="$(pkgutil --check-signature "$package_file" 2>&1)" || [[ "$signature_details" != *"Node.js Foundation"* && "$signature_details" != *"OpenJS Foundation"* ]]; then
      print -u2 "Node.js 설치 패키지의 공식 서명을 확인하지 못했습니다."
      exit 1
    fi
    if ! sudo installer -pkg "$package_file" -target /; then
      print -u2 "Node.js 설치가 거부되었거나 실패했습니다."
      exit 1
    fi
  fi
  rehash
  if ! command -v node >/dev/null 2>&1; then
    print -u2 "Node.js 설치 후 실행 파일을 찾지 못했습니다. 터미널을 다시 연 뒤 시도해 주세요."
    exit 1
  fi
fi

if ! node scripts/build-wiki-graph.mjs; then
  print -u2 "지식 그래프와 대시보드 생성에 실패했습니다."
  exit 1
fi

port=8766
base_url="http://127.0.0.1:8766"
while (( port <= 8775 )); do
  base_url="http://127.0.0.1:$port"
  if curl --silent --fail --max-time 1 "$base_url/api/health" >/dev/null; then
    break
  fi
  if /usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    port=$((port + 1))
    continue
  fi
  log_file="${TMPDIR:-/tmp}/지식관리-대시보드-$port.log"
  ONTOLOGY_EDITOR_PORT=$port nohup node scripts/serve-ontology-editor.mjs >"$log_file" 2>&1 &
  break
done

if (( port > 8775 )); then
  print -u2 "8766~8775 포트가 모두 사용 중이라 대시보드 서버를 시작하지 못했습니다."
  exit 1
fi

attempt=0
while ! curl --silent --fail --max-time 1 "$base_url/dashboard" >/dev/null; do
  attempt=$((attempt + 1))
  if (( attempt >= 50 )); then
    print -u2 "대시보드 서버가 준비되지 않았습니다. 로그를 확인해 주세요: ${log_file:-${TMPDIR:-/tmp}/지식관리-대시보드-$port.log}"
    exit 1
  fi
  sleep 0.2
done

if (( port == 8766 )); then
  open "http://127.0.0.1:8766/dashboard"
else
  open "$base_url/dashboard"
fi
