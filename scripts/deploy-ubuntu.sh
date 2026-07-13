#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 027

readonly DEFAULT_REPO="https://github.com/raj8525/RequestManager.git"
readonly DEFAULT_REVISION="main"
readonly DEFAULT_PORT="13001"
readonly CONTAINER_NAME="request-manager"
readonly CONTAINER_UID="10001"
readonly CONTAINER_GID="10001"

INSTALL_ROOT="${REQUEST_MANAGER_INSTALL_ROOT:-/opt/request-manager}"
DATA_ROOT="${REQUEST_MANAGER_DATA_ROOT:-/var/lib/request-manager}"
CONFIG_ROOT="${REQUEST_MANAGER_CONFIG_ROOT:-/etc/request-manager}"
OS_RELEASE_FILE="${REQUEST_MANAGER_OS_RELEASE_FILE:-/etc/os-release}"
COMMAND_LOG="${REQUEST_MANAGER_COMMAND_LOG:-}"
EFFECTIVE_UID="${REQUEST_MANAGER_EFFECTIVE_UID:-${EUID}}"
ENV_FILE="${CONFIG_ROOT}/request-manager.env"
REVISION_FILE="${CONFIG_ROOT}/revision"

log() { printf '[RequestManager] %s\n' "$1"; }
die() { printf 'Error: %s\n' "$1" >&2; exit 1; }

record_command() {
  [[ -z "${COMMAND_LOG}" ]] || printf '%s\n' "$*" >>"${COMMAND_LOG}"
}

run() {
  record_command "$@"
  "$@"
}

usage() {
  cat <<'USAGE'
RequestManager Ubuntu deployment and complete-data synchronization

Usage:
  deploy-ubuntu.sh deploy [--origin URL] [--port PORT] [--revision REF]
                           [--repo URL] [--skip-admin] [--no-firewall]
  deploy-ubuntu.sh sync SSH_TARGET [--ssh-port PORT] [--origin URL] [--port PORT]
  deploy-ubuntu.sh status
  deploy-ubuntu.sh logs

Commands:
  deploy  Install or update one Docker deployment on Ubuntu.
  sync    Back up local SQLite and screenshots, then replace remote data.
  status  Show the deployed revision, container state and health.
  logs    Follow the last 200 application log lines.
USAGE
}

require_root() {
  [[ "${EFFECTIVE_UID}" == "0" ]] || die "this command must run as root"
}

validate_port() {
  local value="$1"
  [[ "${value}" =~ ^[0-9]+$ ]] || die "invalid port"
  (( 10#${value} >= 1 && 10#${value} <= 65535 )) || die "invalid port"
}

validate_origin() {
  local value="$1"
  [[ "${value}" =~ ^https?://[^/@[:space:]]+(:[0-9]+)?$ ]] || die "invalid origin"
}

validate_revision() {
  local value="$1"
  [[ "${value}" =~ ^[A-Za-z0-9._/-]+$ && "${value}" != *".."* ]] || die "invalid Git revision"
}

validate_repository() {
  local value="$1"
  if [[ "${value}" == http://* || "${value}" == https://* ]]; then
    [[ "${value#*://}" != *@* ]] || die "repository URL must not contain credentials"
    [[ "${value}" =~ ^https?://[A-Za-z0-9._-]+(:[0-9]+)?/[A-Za-z0-9._/-]+$ ]] || die "invalid repository URL"
    return
  fi
  [[ "${value}" =~ ^git@[A-Za-z0-9._-]+:[A-Za-z0-9._/-]+$ ]] || die "invalid repository URL"
}

validate_ssh_target() {
  local value="$1"
  [[ "${value}" =~ ^([A-Za-z_][A-Za-z0-9._-]*@)?([A-Za-z0-9.-]+|\[[0-9A-Fa-f:]+\])$ ]] || die "invalid SSH target"
}

load_ubuntu() {
  [[ -f "${OS_RELEASE_FILE}" ]] || die "Ubuntu release information is unavailable"
  local distribution=""
  local codename=""
  while IFS='=' read -r key raw; do
    raw="${raw%\"}"
    raw="${raw#\"}"
    case "${key}" in
      ID) distribution="${raw}" ;;
      VERSION_CODENAME) codename="${raw}" ;;
    esac
  done <"${OS_RELEASE_FILE}"
  [[ "${distribution}" == "ubuntu" && -n "${codename}" ]] || die "deploy is supported only on Ubuntu"
  UBUNTU_CODENAME="${codename}"
}

command_deploy() {
  local origin=""
  local port="${DEFAULT_PORT}"
  local revision="${DEFAULT_REVISION}"
  local repository="${DEFAULT_REPO}"
  local skip_admin="false"
  local configure_firewall="true"

  while (($#)); do
    case "$1" in
      --origin) (($# >= 2)) || die "--origin requires a value"; origin="$2"; shift 2 ;;
      --port) (($# >= 2)) || die "--port requires a value"; port="$2"; shift 2 ;;
      --revision) (($# >= 2)) || die "--revision requires a value"; revision="$2"; shift 2 ;;
      --repo) (($# >= 2)) || die "--repo requires a value"; repository="$2"; shift 2 ;;
      --skip-admin) skip_admin="true"; shift ;;
      --no-firewall) configure_firewall="false"; shift ;;
      *) die "unknown deploy option" ;;
    esac
  done

  validate_port "${port}"
  [[ -n "${origin}" ]] || origin="http://127.0.0.1:${port}"
  validate_origin "${origin}"
  validate_revision "${revision}"
  validate_repository "${repository}"
  require_root
  load_ubuntu
  deploy_server "${origin}" "${port}" "${revision}" "${repository}" "${skip_admin}" "${configure_firewall}"
}

command_sync() {
  (($# >= 1)) || die "sync requires an SSH target"
  local target="$1"
  shift
  validate_ssh_target "${target}"
  local ssh_port="22"
  local app_port="${DEFAULT_PORT}"
  local origin=""
  while (($#)); do
    case "$1" in
      --ssh-port) (($# >= 2)) || die "--ssh-port requires a value"; ssh_port="$2"; shift 2 ;;
      --port) (($# >= 2)) || die "--port requires a value"; app_port="$2"; shift 2 ;;
      --origin) (($# >= 2)) || die "--origin requires a value"; origin="$2"; shift 2 ;;
      *) die "unknown sync option" ;;
    esac
  done
  validate_port "${ssh_port}"
  validate_port "${app_port}"
  if [[ -z "${origin}" ]]; then
    local host="${target#*@}"
    origin="http://${host}:${app_port}"
  fi
  validate_origin "${origin}"
  sync_to_server "${target}" "${ssh_port}" "${origin}" "${app_port}"
}

command_status() {
  require_root
  [[ -f "${REVISION_FILE}" ]] && printf 'Revision: %s\n' "$(<"${REVISION_FILE}")"
  run docker ps --filter "name=^/${CONTAINER_NAME}$"
  local port="${DEFAULT_PORT}"
  [[ ! -f "${ENV_FILE}" ]] || port="$(sed -n 's/^PUBLISHED_PORT=//p' "${ENV_FILE}" | tail -n 1)"
  run curl --fail --silent --show-error "http://127.0.0.1:${port}/login" >/dev/null
  printf 'Health: OK\n'
}

command_logs() {
  require_root
  run docker logs --follow --tail 200 "${CONTAINER_NAME}"
}

assert_no_symlink_components() {
  local target="$1"
  local current="/"
  local remainder="${target#/}"
  local component
  while [[ -n "${remainder}" ]]; do
    component="${remainder%%/*}"
    [[ "${remainder}" == */* ]] && remainder="${remainder#*/}" || remainder=""
    current="${current%/}/${component}"
    [[ ! -L "${current}" ]] || die "managed paths must not contain symbolic links"
  done
}

ensure_server_dependencies() {
  export DEBIAN_FRONTEND=noninteractive
  run apt-get update
  run apt-get install -y ca-certificates curl git openssh-client
  if ! command -v docker >/dev/null 2>&1; then
    run install -m 0755 -d /etc/apt/keyrings
    run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    run chmod a+r /etc/apt/keyrings/docker.asc
    local architecture
    architecture="$(dpkg --print-architecture)"
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "${architecture}" "${UBUNTU_CODENAME}" >/etc/apt/sources.list.d/docker.list
    run apt-get update
    run apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin
  fi
  run systemctl enable --now docker
}

ensure_checkout() {
  local repository="$1"
  local revision="$2"
  assert_no_symlink_components "${INSTALL_ROOT}"
  if [[ ! -e "${INSTALL_ROOT}" ]]; then
    run git clone --no-checkout "${repository}" "${INSTALL_ROOT}"
  fi
  [[ -d "${INSTALL_ROOT}/.git" && ! -L "${INSTALL_ROOT}/.git" ]] || die "install root is not a Git checkout"
  local actual_origin
  actual_origin="$(git -C "${INSTALL_ROOT}" remote get-url origin)"
  [[ "${actual_origin}" == "${repository}" ]] || die "install checkout uses a different origin"
  [[ -z "$(git -C "${INSTALL_ROOT}" status --porcelain --untracked-files=no)" ]] || die "install checkout has local changes"
  run git -C "${INSTALL_ROOT}" fetch --force --depth 1 origin "${revision}"
  run git -C "${INSTALL_ROOT}" checkout --detach FETCH_HEAD
}

build_revision_image() {
  local revision
  revision="$(git -C "${INSTALL_ROOT}" rev-parse HEAD)"
  DEPLOYED_REVISION="${revision}"
  DEPLOYED_IMAGE="request-manager:${revision:0:12}"
  run docker build --pull --label "org.opencontainers.image.revision=${revision}" -t "${DEPLOYED_IMAGE}" "${INSTALL_ROOT}"
}

prepare_server_paths() {
  assert_no_symlink_components "${DATA_ROOT}"
  assert_no_symlink_components "${CONFIG_ROOT}"
  run install -d -m 0750 -o "${CONTAINER_UID}" -g "${CONTAINER_GID}" \
    "${DATA_ROOT}" "${DATA_ROOT}/uploads" "${DATA_ROOT}/tmp" \
    "${DATA_ROOT}/backups" "${DATA_ROOT}/incoming"
  run install -d -m 0750 "${CONFIG_ROOT}"
}

write_runtime_environment() {
  local origin="$1"
  local port="$2"
  local temporary="${ENV_FILE}.new.$$"
  local secure="false"
  [[ "${origin}" != https://* ]] || secure="true"
  {
    printf 'DATABASE_PATH=/app/data/request-manager.db\n'
    printf 'UPLOADS_PATH=/app/data/uploads\n'
    printf 'TEMP_UPLOADS_PATH=/app/data/tmp\n'
    printf 'BACKUP_PATH=/app/data/backups\n'
    printf 'APP_ORIGIN=%s\n' "${origin}"
    printf 'SECURE_COOKIES=%s\n' "${secure}"
    printf 'TRUST_PROXY_HEADERS=false\n'
    printf 'PUBLISHED_PORT=%s\n' "${port}"
  } >"${temporary}"
  chmod 0600 "${temporary}"
  mv "${temporary}" "${ENV_FILE}"
}

container_exists() {
  docker container inspect "${CONTAINER_NAME}" >/dev/null 2>&1
}

container_running() {
  [[ "$(docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null || true)" == "true" ]]
}

one_shot() {
  local image="$1"
  shift
  run docker run --rm --env-file "${ENV_FILE}" \
    --mount "type=bind,src=${DATA_ROOT},dst=/app/data" \
    "${image}" "$@"
}

start_application() {
  local image="$1"
  local port="$2"
  run docker run -d --name "${CONTAINER_NAME}" --restart unless-stopped \
    --env-file "${ENV_FILE}" \
    --mount "type=bind,src=${DATA_ROOT},dst=/app/data" \
    --publish "${port}:13001" \
    "${image}"
}

wait_for_health() {
  local port="$1"
  local attempt
  for ((attempt = 1; attempt <= 30; attempt += 1)); do
    if curl --fail --silent --show-error "http://127.0.0.1:${port}/login" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

newest_backup() {
  local newest=""
  local path
  shopt -s nullglob
  for path in "${DATA_ROOT}"/backups/request-manager-*; do
    [[ -d "${path}" ]] || continue
    if [[ -z "${newest}" || "${path}" -nt "${newest}" ]]; then newest="${path}"; fi
  done
  shopt -u nullglob
  [[ -n "${newest}" ]] || return 1
  printf '%s\n' "${newest}"
}

backup_running_service() {
  run docker exec "${CONTAINER_NAME}" npm run ops:backup >&2
  newest_backup
}

backup_existing_service() {
  local image="$1"
  if container_running; then
    backup_running_service
  else
    one_shot "${image}" npm run ops:backup >&2
    newest_backup
  fi
}

initialize_admin() {
  local image="$1"
  local password="${REQUEST_MANAGER_ADMIN_PASSWORD:-}"
  if [[ -z "${password}" && -r /dev/tty && -w /dev/tty ]]; then
    read -r -s -p "First developer password (10-128 characters): " password </dev/tty
    printf '\n' >/dev/tty
  fi
  [[ -n "${password}" ]] || { printf 'Error: set REQUEST_MANAGER_ADMIN_PASSWORD for non-interactive first deployment\n' >&2; return 1; }
  [[ "${password}" != *$'\n'* ]] || { printf 'Error: administrator password must not contain a newline\n' >&2; return 1; }
  local secret_file="${CONFIG_ROOT}/admin-init.$$"
  trap 'rm -f -- "${secret_file:-}"' RETURN
  {
    printf 'ADMIN_USERNAME=%s\n' "${REQUEST_MANAGER_ADMIN_USERNAME:-admin}"
    printf 'ADMIN_DISPLAY_NAME=%s\n' "${REQUEST_MANAGER_ADMIN_DISPLAY_NAME:-Administrator}"
    printf 'ADMIN_PASSWORD=%s\n' "${password}"
  } >"${secret_file}"
  chmod 0600 "${secret_file}"
  run docker run --rm --env-file "${ENV_FILE}" --env-file "${secret_file}" \
    --mount "type=bind,src=${DATA_ROOT},dst=/app/data" \
    "${image}" npm run admin:init || return 1
  rm -f -- "${secret_file}"
  trap - RETURN
}

rollback_release() {
  local old_image="$1"
  local backup_path="$2"
  local port="$3"
  log "New release failed; restoring the previous release."
  if container_exists; then
    run docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    run docker rm "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi
  local container_backup
  container_backup="/app/data/backups/$(basename "${backup_path}")"
  one_shot "${old_image}" npm run ops:restore -- "${container_backup}" --confirm-restore --app-stopped
  start_application "${old_image}" "${port}" >/dev/null
  wait_for_health "${port}"
}

configure_ufw() {
  local port="$1"
  command -v ufw >/dev/null 2>&1 || return 0
  ufw status 2>/dev/null | grep -q '^Status: active' || return 0
  run ufw allow "${port}/tcp"
}

deploy_server() {
  local origin="$1"
  local port="$2"
  local revision="$3"
  local repository="$4"
  local skip_admin="$5"
  local configure_firewall="$6"

  ensure_server_dependencies
  ensure_checkout "${repository}" "${revision}"
  build_revision_image
  prepare_server_paths

  local fresh_database="false"
  [[ -f "${DATA_ROOT}/request-manager.db" ]] || fresh_database="true"
  local needs_admin="false"
  [[ ! -f "${CONFIG_ROOT}/needs-admin" ]] || needs_admin="true"
  if [[ "${fresh_database}" == "true" ]]; then
    : >"${CONFIG_ROOT}/needs-admin"
    chmod 0600 "${CONFIG_ROOT}/needs-admin"
    needs_admin="true"
  fi
  local old_image=""
  local old_backup=""
  if container_exists; then
    old_image="$(docker inspect -f '{{.Config.Image}}' "${CONTAINER_NAME}")"
    old_backup="$(backup_existing_service "${old_image}")"
  fi

  write_runtime_environment "${origin}" "${port}"
  if container_exists; then
    run docker stop "${CONTAINER_NAME}"
    run docker rm "${CONTAINER_NAME}"
  fi

  if ! one_shot "${DEPLOYED_IMAGE}" npm run db:migrate; then
    [[ -n "${old_image}" && -n "${old_backup}" ]] && rollback_release "${old_image}" "${old_backup}" "${port}" || true
    die "database migration failed"
  fi

  if [[ "${needs_admin}" == "true" && "${skip_admin}" != "true" ]]; then
    if ! initialize_admin "${DEPLOYED_IMAGE}"; then
      [[ -n "${old_image}" && -n "${old_backup}" ]] && rollback_release "${old_image}" "${old_backup}" "${port}" || true
      die "first administrator initialization failed"
    fi
    rm -f -- "${CONFIG_ROOT}/needs-admin"
  fi

  if ! start_application "${DEPLOYED_IMAGE}" "${port}" >/dev/null; then
    [[ -n "${old_image}" && -n "${old_backup}" ]] && rollback_release "${old_image}" "${old_backup}" "${port}" || true
    die "application container could not start"
  fi
  if ! wait_for_health "${port}"; then
    [[ -n "${old_image}" && -n "${old_backup}" ]] && rollback_release "${old_image}" "${old_backup}" "${port}" || true
    die "application health check failed"
  fi
  [[ "${configure_firewall}" != "true" ]] || configure_ufw "${port}"
  printf '%s\n' "${DEPLOYED_REVISION}" >"${REVISION_FILE}"
  chmod 0600 "${REVISION_FILE}"
  log "Deployment complete: ${origin} (${DEPLOYED_REVISION})"
}

confirm_sync() {
  local target="$1"
  local revision="$2"
  local backup="$3"
  printf 'Source backup: %s\nTarget server: %s\nGit revision: %s\n' "${backup}" "${target}" "${revision}"
  [[ "${REQUEST_MANAGER_SYNC_CONFIRM:-}" != "yes" ]] || return 0
  [[ -t 0 ]] || die "set REQUEST_MANAGER_SYNC_CONFIRM=yes to confirm remote replacement"
  local answer
  read -r -p "Type yes to replace all remote RequestManager data: " answer
  [[ "${answer}" == "yes" ]] || die "synchronization cancelled"
}

remote_root_script() {
  local target="$1"
  local ssh_port="$2"
  shift 2
  local quoted_args=""
  local argument
  for argument in "$@"; do
    [[ "${argument}" != *"'"* ]] || die "unsafe remote argument"
    quoted_args+=" '${argument}'"
  done
  local remote_command
  remote_command="if [ \"\$(id -u)\" -eq 0 ]; then exec bash -s --${quoted_args}; else exec sudo bash -s --${quoted_args}; fi"
  record_command ssh -p "${ssh_port}" "${target}" bash -s -- "$@"
  ssh -p "${ssh_port}" "${target}" "${remote_command}" <"${BASH_SOURCE[0]}"
}

remote_deploy() {
  local target="$1"
  local ssh_port="$2"
  local revision="$3"
  local origin="$4"
  local port="$5"
  remote_root_script "${target}" "${ssh_port}" deploy --revision "${revision}" --origin "${origin}" --port "${port}" --skip-admin
}

sync_to_server() {
  local target="$1"
  local ssh_port="$2"
  local origin="$3"
  local port="$4"
  local script_path
  script_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  local repository_root
  repository_root="$(git -C "$(dirname "${script_path}")/.." rev-parse --show-toplevel)"
  [[ -z "$(git -C "${repository_root}" status --porcelain --untracked-files=no)" ]] || die "local tracked files must be committed before synchronization"
  run git -C "${repository_root}" fetch origin
  local revision
  revision="$(git -C "${repository_root}" rev-parse HEAD)"
  git -C "${repository_root}" branch -r --contains "${revision}" | grep -q . || die "local revision has not been pushed to origin"

  local temporary_root
  temporary_root="$(mktemp -d "${TMPDIR:-/tmp}/request-manager-sync.XXXXXX")"
  cleanup_sync_temp() {
    if [[ -n "${temporary_root:-}" && "${temporary_root}" == *request-manager-sync.* && -d "${temporary_root}" ]]; then
      find "${temporary_root}" -depth -delete
    fi
  }
  trap cleanup_sync_temp EXIT
  mkdir -p "${temporary_root}/backups"
  (cd "${repository_root}" && BACKUP_PATH="${temporary_root}/backups" npm run ops:backup)
  local backups=("${temporary_root}"/backups/request-manager-*)
  [[ ${#backups[@]} == 1 && -d "${backups[0]}" ]] || die "local backup did not produce exactly one complete directory"
  local backup="${backups[0]}"
  confirm_sync "${target}" "${revision}" "${backup}"

  remote_deploy "${target}" "${ssh_port}" "${revision}" "${origin}" "${port}"
  local remote_home
  record_command ssh -p "${ssh_port}" "${target}" pwd
  remote_home="$(ssh -p "${ssh_port}" "${target}" pwd)"
  [[ "${remote_home}" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "remote home path is unsafe"
  local remote_name
  remote_name="$(basename "${backup}")-$(date +%s)-$$"
  local remote_path="${remote_home}/.request-manager-sync/${remote_name}"
  run ssh -p "${ssh_port}" "${target}" mkdir -p .request-manager-sync
  record_command scp -P "${ssh_port}" -r -- "${backup}" "${target}:${remote_path}"
  scp -P "${ssh_port}" -r -- "${backup}" "${target}:${remote_path}"
  remote_root_script "${target}" "${ssh_port}" __receive-backup "${remote_path}" "${port}"
  cleanup_sync_temp
  trap - EXIT
  log "Complete database and screenshot synchronization succeeded."
}

receive_uploaded_backup() {
  local source_path="$1"
  local port="$2"
  require_root
  validate_port "${port}"
  [[ "${source_path}" =~ ^/[A-Za-z0-9._/-]+/\.request-manager-sync/request-manager-[A-Za-z0-9._-]+$ ]] || die "unsafe uploaded backup path"
  [[ -d "${source_path}" && ! -L "${source_path}" ]] || die "uploaded backup is not a regular directory"
  [[ -z "$(find "${source_path}" -type l -print -quit)" ]] || die "uploaded backup must not contain symbolic links"
  [[ -f "${ENV_FILE}" ]] || die "server runtime environment is missing"
  container_running || die "RequestManager must be running before synchronization"

  local image
  image="$(docker inspect -f '{{.Config.Image}}' "${CONTAINER_NAME}")"
  local protection_backup
  protection_backup="$(backup_running_service)"
  local incoming
  incoming="${DATA_ROOT}/incoming/$(basename "${source_path}")"
  [[ ! -e "${incoming}" ]] || die "incoming backup already exists"
  run mv "${source_path}" "${incoming}"
  run chown -R "${CONTAINER_UID}:${CONTAINER_GID}" "${incoming}"
  local container_incoming
  container_incoming="/app/data/incoming/$(basename "${incoming}")"

  run docker stop "${CONTAINER_NAME}"
  if ! one_shot "${image}" npm run ops:restore -- "${container_incoming}" --confirm-restore --app-stopped; then
    run docker start "${CONTAINER_NAME}" >/dev/null
    die "uploaded backup validation or restore failed; original service restarted"
  fi
  run docker start "${CONTAINER_NAME}" >/dev/null
  if ! wait_for_health "${port}" || ! run docker exec "${CONTAINER_NAME}" npm run ops:attachments:check; then
    run docker stop "${CONTAINER_NAME}" >/dev/null 2>&1 || true
    local protection_container
    protection_container="/app/data/backups/$(basename "${protection_backup}")"
    one_shot "${image}" npm run ops:restore -- "${protection_container}" --confirm-restore --app-stopped
    run docker start "${CONTAINER_NAME}" >/dev/null
    wait_for_health "${port}" || true
    die "restored data failed verification; previous remote data was restored"
  fi
  find "${incoming}" -depth -delete
  rm -f -- "${CONFIG_ROOT}/needs-admin"
}

main() {
  local command="${1:---help}"
  [[ $# == 0 ]] || shift
  case "${command}" in
    --help|-h|help) usage ;;
    deploy) command_deploy "$@" ;;
    sync) command_sync "$@" ;;
    status) command_status "$@" ;;
    logs) command_logs "$@" ;;
    __receive-backup) (($# == 2)) || die "invalid remote restore arguments"; receive_uploaded_backup "$1" "$2" ;;
    *) usage >&2; die "unknown command" ;;
  esac
}

main "$@"
