const DEVICE_AGENT_VERSION = '1.2.0';

function buildDeviceAgentScript() {
    return `#!/usr/bin/env python3
import calendar
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

AGENT_VERSION = '${DEVICE_AGENT_VERSION}'
POLL_INTERVAL_SECONDS = 6
HEALTH_INTERVAL_SECONDS = 45
SUPPORTED_COMMANDS = [
    'reboot_device',
    'shutdown_device',
    'restart_player_process',
    'set_system_volume',
    'rotate_display',
    'capture_screenshot',
    'restart_device_agent',
    'update_device_agent',
    'update_player_launcher',
    'repair_installation',
]

CONFIG_PATH = Path(__file__).with_name('config.json')
DEFAULT_AGENT_SERVICE_NAME = 'signage-device-agent.service'
DEFAULT_POLICY = {
    'watchdogEnabled': True,
    'otaChannel': 'stable',
    'autoAgentUpdates': False,
    'autoLauncherUpdates': False,
    'playerRestartGraceSeconds': 45,
    'rebootAfterConsecutivePlayerFailures': 3,
    'maxCpuTemperatureC': 82,
    'maxDiskUsedPercent': 94,
    'maxMemoryUsedPercent': 96,
}


def clamp_number(value, minimum, maximum, fallback):
    try:
        parsed = float(value)
    except Exception:
        return fallback

    parsed = max(minimum, min(maximum, parsed))
    if isinstance(fallback, int):
        return int(parsed)
    return parsed


def normalize_bool(value, fallback=False):
    if value is None:
        return fallback
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0

    normalized = str(value).strip().lower()
    if normalized in ['true', '1', 'yes', 'on']:
        return True
    if normalized in ['false', '0', 'no', 'off']:
        return False
    return fallback


def normalize_policy(policy):
    safe_policy = policy if isinstance(policy, dict) else {}
    ota_channel = str(safe_policy.get('otaChannel', DEFAULT_POLICY['otaChannel'])).strip().lower()
    if ota_channel not in ['stable', 'beta']:
        ota_channel = DEFAULT_POLICY['otaChannel']

    return {
        'watchdogEnabled': normalize_bool(safe_policy.get('watchdogEnabled'), DEFAULT_POLICY['watchdogEnabled']),
        'otaChannel': ota_channel,
        'autoAgentUpdates': normalize_bool(safe_policy.get('autoAgentUpdates'), DEFAULT_POLICY['autoAgentUpdates']),
        'autoLauncherUpdates': normalize_bool(safe_policy.get('autoLauncherUpdates'), DEFAULT_POLICY['autoLauncherUpdates']),
        'playerRestartGraceSeconds': clamp_number(
            safe_policy.get('playerRestartGraceSeconds'),
            15,
            600,
            DEFAULT_POLICY['playerRestartGraceSeconds'],
        ),
        'rebootAfterConsecutivePlayerFailures': clamp_number(
            safe_policy.get('rebootAfterConsecutivePlayerFailures'),
            1,
            10,
            DEFAULT_POLICY['rebootAfterConsecutivePlayerFailures'],
        ),
        'maxCpuTemperatureC': clamp_number(
            safe_policy.get('maxCpuTemperatureC'),
            60,
            100,
            DEFAULT_POLICY['maxCpuTemperatureC'],
        ),
        'maxDiskUsedPercent': clamp_number(
            safe_policy.get('maxDiskUsedPercent'),
            70,
            99,
            DEFAULT_POLICY['maxDiskUsedPercent'],
        ),
        'maxMemoryUsedPercent': clamp_number(
            safe_policy.get('maxMemoryUsedPercent'),
            70,
            99,
            DEFAULT_POLICY['maxMemoryUsedPercent'],
        ),
    }


def load_json_file(path_obj, fallback):
    try:
        return json.loads(path_obj.read_text(encoding='utf-8'))
    except Exception:
        if isinstance(fallback, dict):
            return dict(fallback)
        if isinstance(fallback, list):
            return list(fallback)
        return fallback


def load_config():
    config = load_json_file(CONFIG_PATH, {})
    launcher_path = config.get('launcher_path') or str(Path(__file__).with_name('launch.sh'))
    config.setdefault('launcher_path', launcher_path)
    config.setdefault('device_agent_path', str(Path(__file__)))
    config.setdefault('device_state_path', str(Path(launcher_path).with_name('agent-state.json')))
    config.setdefault('agent_service_name', DEFAULT_AGENT_SERVICE_NAME)
    config['device_policy'] = normalize_policy(config.get('device_policy'))
    return config


def save_config(config):
    CONFIG_PATH.write_text(json.dumps(config, indent=2), encoding='utf-8')


def get_state_path(config):
    return Path(config.get('device_state_path') or Path(__file__).with_name('agent-state.json'))


def normalize_state(state):
    safe_state = state if isinstance(state, dict) else {}
    history = []
    for entry in safe_state.get('recoveryHistory', []):
        if isinstance(entry, dict) and entry.get('at'):
            history.append({
                'action': entry.get('action'),
                'at': entry.get('at'),
            })

    return {
        'playerMissingSince': safe_state.get('playerMissingSince'),
        'lastPlayerRestartAt': safe_state.get('lastPlayerRestartAt'),
        'lastRebootAttemptAt': safe_state.get('lastRebootAttemptAt'),
        'consecutivePlayerFailures': clamp_number(
            safe_state.get('consecutivePlayerFailures'),
            0,
            50,
            0,
        ),
        'lastRecoveryAction': safe_state.get('lastRecoveryAction'),
        'lastRecoveryAt': safe_state.get('lastRecoveryAt'),
        'recoveryHistory': history[-80:],
    }


def load_state(config):
    return normalize_state(load_json_file(get_state_path(config), {}))


def save_state(config, state):
    get_state_path(config).write_text(json.dumps(normalize_state(state), indent=2), encoding='utf-8')


def iso_now():
    return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())


def parse_timestamp(value):
    if not value:
        return None

    normalized = str(value).strip()
    if not normalized:
        return None

    for fmt in ['%Y-%m-%dT%H:%M:%SZ', '%Y-%m-%d %H:%M:%S']:
        try:
            parsed = time.strptime(normalized, fmt)
            if fmt.endswith('Z'):
                return calendar.timegm(parsed)
            return time.mktime(parsed)
        except Exception:
            continue
    return None


def seconds_since(value, now_epoch=None):
    parsed = parse_timestamp(value)
    if parsed is None:
        return None
    now_epoch = now_epoch if now_epoch is not None else time.time()
    return max(0, int(now_epoch - parsed))


def trim_recovery_history(state):
    cutoff = time.time() - (24 * 60 * 60)
    trimmed = []
    for entry in state.get('recoveryHistory', []):
        entry_time = parse_timestamp(entry.get('at'))
        if entry_time is not None and entry_time >= cutoff:
            trimmed.append(entry)
    state['recoveryHistory'] = trimmed[-80:]


def record_recovery_action(state, action):
    timestamp = iso_now()
    state['lastRecoveryAction'] = action
    state['lastRecoveryAt'] = timestamp
    state.setdefault('recoveryHistory', []).append({
        'action': action,
        'at': timestamp,
    })
    trim_recovery_history(state)


def get_recovery_count_last_24h(state):
    trim_recovery_history(state)
    return len(state.get('recoveryHistory', []))


def api_request(method, path, payload=None, timeout=20, extra_headers=None):
    config = load_config()
    base_url = config['server_url'].rstrip('/')
    request_url = f"{base_url}/api{path}"
    request_data = None
    headers = {
        'x-screen-token': config['screen_token'],
    }

    if extra_headers:
        headers.update(extra_headers)

    if payload is not None:
        request_data = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    request = urllib.request.Request(request_url, data=request_data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
        content_type = response.headers.get('Content-Type', '')

        if 'application/json' in content_type:
            text = body.decode('utf-8')
            return json.loads(text) if text else {}

        return body


def api_request_text(method, path, timeout=20):
    response = api_request(method, path, timeout=timeout)
    if isinstance(response, bytes):
        return response.decode('utf-8')
    if isinstance(response, str):
        return response
    return json.dumps(response)


def log_event(level, category, message, details=None):
    config = load_config()
    payload = {
        'level': level,
        'category': category,
        'message': message,
        'details': details,
        'createdAt': iso_now(),
    }

    try:
        return api_request('POST', f"/screens/{config['screen_id']}/player-events", payload)
    except Exception:
        return None


def read_first_line(path_text):
    try:
        return Path(path_text).read_text(encoding='utf-8').strip().splitlines()[0]
    except Exception:
        return None


def get_uptime_seconds():
    uptime_line = read_first_line('/proc/uptime')
    if not uptime_line:
        return None

    try:
        return int(float(uptime_line.split()[0]))
    except Exception:
        return None


def get_cpu_temperature_c():
    raw_value = read_first_line('/sys/class/thermal/thermal_zone0/temp')
    if not raw_value:
        return None

    try:
        return round(int(raw_value) / 1000.0, 1)
    except Exception:
        return None


def get_memory_info():
    result = {}
    try:
        with open('/proc/meminfo', 'r', encoding='utf-8') as handle:
            for line in handle:
                key, value = line.split(':', 1)
                result[key.strip()] = int(value.strip().split()[0]) * 1024
    except Exception:
        return {}

    total = result.get('MemTotal')
    available = result.get('MemAvailable')
    if total is None:
        return {}

    used = total - available if available is not None else None
    return {
        'totalBytes': total,
        'availableBytes': available,
        'usedBytes': used,
        'usedPercent': round((used / total) * 100, 1) if total and used is not None else None,
    }


def get_disk_info():
    try:
        usage = shutil.disk_usage('/')
        return {
            'totalBytes': usage.total,
            'usedBytes': usage.used,
            'freeBytes': usage.free,
            'usedPercent': round((usage.used / usage.total) * 100, 1) if usage.total else None,
        }
    except Exception:
        return {}


def get_ip_addresses():
    addresses = set()
    try:
        output = subprocess.check_output(['hostname', '-I'], text=True, stderr=subprocess.DEVNULL).strip()
        for entry in output.split():
            if entry:
                addresses.add(entry)
    except Exception:
        pass

    try:
        hostname = socket.gethostname()
        for family_info in socket.getaddrinfo(hostname, None):
            address = family_info[4][0]
            if ':' not in address and not address.startswith('127.'):
                addresses.add(address)
    except Exception:
        pass

    return sorted(addresses)


def get_load_average():
    try:
        one, five, fifteen = os.getloadavg()
        return {
            'one': round(one, 2),
            'five': round(five, 2),
            'fifteen': round(fifteen, 2),
        }
    except Exception:
        return None


def is_player_process_running():
    try:
        result = subprocess.run(
            ['pgrep', '-f', 'chromium|signage-player/launch.sh'],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        return result.returncode == 0
    except Exception:
        return None


def read_system_volume():
    try:
        output = subprocess.check_output(['amixer', 'sget', 'Master'], text=True, stderr=subprocess.DEVNULL)
        for line in output.splitlines():
            marker_start = line.rfind('[')
            marker_end = line.rfind('%]')
            if marker_start != -1 and marker_end != -1 and marker_end > marker_start:
                return int(line[marker_start + 1:marker_end])
    except Exception:
        return None
    return None


def run_command(arguments, check=True):
    return subprocess.run(arguments, check=check, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def find_connected_display():
    try:
        output = subprocess.check_output(['xrandr', '--query'], text=True, stderr=subprocess.DEVNULL)
        for line in output.splitlines():
            if ' connected' in line:
                return line.split()[0]
    except Exception:
        return None
    return None


def schedule_shell_action(command):
    subprocess.Popen(
        ['bash', '-lc', f"sleep 2 && {command} >/dev/null 2>&1"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def resolve_chromium_binary(config):
    configured = config.get('chromium_bin')
    if configured and Path(configured).exists():
        return configured

    for candidate in ['chromium-browser', 'chromium']:
        resolved = shutil.which(candidate)
        if resolved:
            return resolved
    return None


def render_player_launcher(config):
    chromium_bin = resolve_chromium_binary(config)
    player_url = config.get('player_url')
    if not chromium_bin:
        raise RuntimeError('Chromium binary not found.')
    if not player_url:
        raise RuntimeError('player_url missing from config.')

    config['chromium_bin'] = chromium_bin
    return """#!/usr/bin/env bash
set -euo pipefail
xset s off || true
xset -dpms || true
xset s noblank || true
pkill unclutter >/dev/null 2>&1 || true
unclutter -idle 0.1 -root >/dev/null 2>&1 &
exec "{chromium_bin}" --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 --overscroll-history-navigation=0 "{player_url}"
""".format(chromium_bin=chromium_bin, player_url=player_url)


def write_player_launcher(config):
    launcher_path = Path(config.get('launcher_path') or Path(__file__).with_name('launch.sh'))
    launcher_path.write_text(render_player_launcher(config), encoding='utf-8')
    launcher_path.chmod(0o755)
    config['launcher_path'] = str(launcher_path)
    save_config(config)
    return launcher_path


def launch_player_process(config):
    launcher_path = config.get('launcher_path')
    if not launcher_path:
        raise RuntimeError('launcher_path missing from config.')

    subprocess.Popen(
        ['bash', '-lc', f"{launcher_path} >/dev/null 2>&1 &"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def restart_player_process(config, kill_existing=True):
    if kill_existing:
        subprocess.run(['pkill', '-f', 'chromium'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        time.sleep(1)
    launch_player_process(config)


def schedule_system_action(command):
    schedule_shell_action(command)


def schedule_service_restart(service_name):
    safe_service = service_name or DEFAULT_AGENT_SERVICE_NAME
    schedule_shell_action(f"sudo /usr/bin/systemctl restart {safe_service}")


def fetch_latest_agent_script(config):
    return api_request_text('GET', f"/screens/{config['screen_id']}/device-agent-script", timeout=30)


def upload_screenshot(command_id, screenshot_path, mime_type):
    config = load_config()
    query = urllib.parse.urlencode({'commandId': command_id}) if command_id else ''
    path = f"/screens/{config['screen_id']}/device-screenshots"
    if query:
        path = f"{path}?{query}"

    base_url = config['server_url'].rstrip('/')
    request_url = f"{base_url}/api{path}"
    with open(screenshot_path, 'rb') as handle:
        data = handle.read()

    request = urllib.request.Request(
        request_url,
        data=data,
        headers={
            'x-screen-token': config['screen_token'],
            'Content-Type': mime_type,
        },
        method='POST',
    )

    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode('utf-8')
        return json.loads(body) if body else {}


def apply_launcher_update(config, restart_player=False):
    launcher_path = write_player_launcher(config)
    ota_manifest = config.get('ota_manifest') or {}
    config['player_launcher_version'] = ota_manifest.get('playerLauncherVersion') or config.get('player_launcher_version')
    save_config(config)

    if restart_player:
        restart_player_process(config)

    return {
        'updated': True,
        'launcherPath': str(launcher_path),
        'playerLauncherVersion': config.get('player_launcher_version'),
        'playerRestarted': restart_player,
    }


def apply_agent_update(config, reason='manual', schedule_restart=True):
    latest_script = fetch_latest_agent_script(config)
    agent_path = Path(config.get('device_agent_path') or __file__)
    backup_path = agent_path.with_name('device-agent.previous.py')
    current_script = agent_path.read_text(encoding='utf-8') if agent_path.exists() else ''

    if latest_script.strip() != current_script.strip():
        if current_script:
            backup_path.write_text(current_script, encoding='utf-8')
        agent_path.write_text(latest_script, encoding='utf-8')
        agent_path.chmod(0o755)

    ota_manifest = config.get('ota_manifest') or {}
    config['agent_version'] = ota_manifest.get('agentVersion') or config.get('agent_version') or AGENT_VERSION
    save_config(config)

    if schedule_restart:
        schedule_service_restart(config.get('agent_service_name'))

    return {
        'updated': latest_script.strip() != current_script.strip(),
        'agentPath': str(agent_path),
        'backupPath': str(backup_path),
        'agentVersion': config.get('agent_version'),
        'reason': reason,
        'restartScheduled': schedule_restart,
    }


def apply_auto_updates(config):
    policy = normalize_policy(config.get('device_policy'))
    ota_manifest = config.get('ota_manifest') or {}
    actions = []

    if policy.get('autoLauncherUpdates') and ota_manifest.get('playerLauncherVersion') and ota_manifest.get('playerLauncherVersion') != config.get('player_launcher_version'):
        result = apply_launcher_update(config, restart_player=True)
        actions.append({
            'type': 'update_player_launcher',
            'result': result,
        })
        log_event('info', 'ota', 'Player-Launcher automatisch aktualisiert.', result)

    if policy.get('autoAgentUpdates') and ota_manifest.get('agentVersion') and ota_manifest.get('agentVersion') != config.get('agent_version'):
        result = apply_agent_update(config, reason='auto-policy', schedule_restart=True)
        actions.append({
            'type': 'update_device_agent',
            'result': result,
        })
        log_event('info', 'ota', 'Device-Agent automatisch aktualisiert.', result)

    return actions


def collect_health(config, state):
    policy = normalize_policy(config.get('device_policy'))
    player_running = is_player_process_running()
    return {
        'hostname': socket.gethostname(),
        'platform': sys.platform,
        'pythonVersion': sys.version.split()[0],
        'uptimeSeconds': get_uptime_seconds(),
        'cpuTemperatureC': get_cpu_temperature_c(),
        'memory': get_memory_info(),
        'disk': get_disk_info(),
        'loadAverage': get_load_average(),
        'ipAddresses': get_ip_addresses(),
        'playerProcessRunning': player_running,
        'systemVolumePercent': read_system_volume(),
        'display': os.environ.get('DISPLAY') or None,
        'launcherPath': config.get('launcher_path'),
        'playerLauncherVersion': config.get('player_launcher_version'),
        'otaChannel': policy.get('otaChannel'),
        'watchdog': {
            'enabled': policy.get('watchdogEnabled'),
            'consecutivePlayerFailures': state.get('consecutivePlayerFailures', 0),
            'lastRecoveryAction': state.get('lastRecoveryAction'),
            'lastRecoveryAt': state.get('lastRecoveryAt'),
            'playerMissingSince': state.get('playerMissingSince'),
            'recoveryActionsLast24h': get_recovery_count_last_24h(state),
        },
    }


def post_health(config, state):
    payload = {
        'agentVersion': AGENT_VERSION,
        'capabilities': SUPPORTED_COMMANDS,
        'health': collect_health(config, state),
        'reportedAt': iso_now(),
    }
    response = api_request('POST', f"/screens/{config['screen_id']}/device-health", payload)

    if isinstance(response, dict):
        if isinstance(response.get('policy'), dict):
            config['device_policy'] = normalize_policy(response['policy'])
        if isinstance(response.get('ota'), dict):
            config['ota_manifest'] = response['ota']
        save_config(config)

    return response


def fetch_commands(config):
    query = urllib.parse.urlencode({'target': 'agent', 'limit': 8})
    return api_request('GET', f"/screens/{config['screen_id']}/device-commands/pending?{query}")


def update_command(config, command_id, status, message, result=None):
    payload = {
        'status': status,
        'message': message,
        'result': result,
        'reportedAt': iso_now(),
    }
    return api_request('POST', f"/screens/{config['screen_id']}/device-commands/{command_id}/status", payload)


def run_watchdog_cycle(config, state):
    policy = normalize_policy(config.get('device_policy'))
    state = normalize_state(state)
    player_running = is_player_process_running()

    if player_running:
        state['playerMissingSince'] = None
        state['consecutivePlayerFailures'] = 0
        return state

    if not policy.get('watchdogEnabled'):
        return state

    now_epoch = time.time()
    if not state.get('playerMissingSince'):
        state['playerMissingSince'] = iso_now()
        return state

    seconds_missing = seconds_since(state.get('playerMissingSince'), now_epoch)
    last_restart_seconds = seconds_since(state.get('lastPlayerRestartAt'), now_epoch)
    restart_grace = policy.get('playerRestartGraceSeconds', DEFAULT_POLICY['playerRestartGraceSeconds'])

    if seconds_missing is None or seconds_missing < restart_grace:
        return state

    if last_restart_seconds is not None and last_restart_seconds < restart_grace:
        return state

    restart_player_process(config, kill_existing=False)
    state['lastPlayerRestartAt'] = iso_now()
    state['consecutivePlayerFailures'] = int(state.get('consecutivePlayerFailures', 0)) + 1
    record_recovery_action(state, 'restart_player_process')
    log_event(
        'warning',
        'watchdog',
        'Watchdog hat den Player-Prozess neu gestartet.',
        {
            'consecutivePlayerFailures': state.get('consecutivePlayerFailures', 0),
            'playerMissingSince': state.get('playerMissingSince'),
        },
    )

    if state.get('consecutivePlayerFailures', 0) >= policy.get('rebootAfterConsecutivePlayerFailures', DEFAULT_POLICY['rebootAfterConsecutivePlayerFailures']):
        last_reboot_seconds = seconds_since(state.get('lastRebootAttemptAt'), now_epoch)
        if last_reboot_seconds is None or last_reboot_seconds >= restart_grace:
            schedule_system_action('sudo /usr/sbin/reboot || sudo /sbin/reboot')
            state['lastRebootAttemptAt'] = iso_now()
            state['consecutivePlayerFailures'] = 0
            record_recovery_action(state, 'reboot_device')
            log_event(
                'error',
                'recovery',
                'Watchdog hat nach wiederholten Player-Ausfaellen einen Reboot geplant.',
                {
                    'rebootAfterConsecutivePlayerFailures': policy.get('rebootAfterConsecutivePlayerFailures'),
                },
            )

    return state


def execute_command(command):
    config = load_config()
    command_id = command.get('id')
    command_type = command.get('command_type')
    payload = command.get('payload') or {}

    if command_type == 'restart_player_process':
        restart_player_process(config)
        return 'Chromium und Player-Prozess neu gestartet.', {'launcherPath': config.get('launcher_path')}

    if command_type == 'set_system_volume':
        level = int(max(0, min(100, int(payload.get('level', 50)))))
        run_command(['amixer', 'sset', 'Master', f'{level}%'])
        return f'Systemlautstaerke auf {level}% gesetzt.', {'level': level}

    if command_type == 'rotate_display':
        rotation = payload.get('rotation', 'normal')
        if rotation not in ['normal', 'left', 'right', 'inverted']:
            raise RuntimeError('Unsupported rotation value.')

        output_name = payload.get('output') or find_connected_display()
        if not output_name:
            raise RuntimeError('No connected display detected.')

        run_command(['xrandr', '--output', output_name, '--rotate', rotation])
        return f'Display {output_name} auf {rotation} gedreht.', {'rotation': rotation, 'output': output_name}

    if command_type == 'capture_screenshot':
        if not shutil.which('scrot'):
            raise RuntimeError('scrot is not installed on this device.')

        image_format = 'png' if payload.get('format') == 'png' else 'jpeg'
        quality = int(max(20, min(100, int(payload.get('quality', 65)))))
        suffix = '.png' if image_format == 'png' else '.jpg'
        mime_type = 'image/png' if image_format == 'png' else 'image/jpeg'
        screenshot_path = Path('/tmp') / f"signage-screenshot-{int(time.time() * 1000)}{suffix}"

        arguments = ['scrot']
        if image_format == 'jpeg':
            arguments.extend(['-q', str(quality)])
        arguments.append(str(screenshot_path))

        try:
            run_command(arguments)
            if not screenshot_path.exists():
                raise RuntimeError('Screenshot file was not created.')

            uploaded = upload_screenshot(command_id, screenshot_path, mime_type)
            return 'Screenshot erfolgreich erfasst.', {
                'format': image_format,
                'quality': quality,
                'screenshot': uploaded,
            }
        finally:
            try:
                screenshot_path.unlink(missing_ok=True)
            except Exception:
                pass

    if command_type == 'restart_device_agent':
        schedule_service_restart(config.get('agent_service_name'))
        return 'Device-Agent-Restart wurde eingeplant.', {
            'service': config.get('agent_service_name') or DEFAULT_AGENT_SERVICE_NAME,
            'restartScheduled': True,
        }

    if command_type == 'update_device_agent':
        result = apply_agent_update(config, reason='remote-command', schedule_restart=True)
        return 'Device-Agent aktualisiert. Neustart des Agent-Service ist eingeplant.', result

    if command_type == 'update_player_launcher':
        result = apply_launcher_update(config, restart_player=True)
        return 'Player-Launcher aktualisiert und Browser neu gestartet.', result

    if command_type == 'repair_installation':
        launcher_result = apply_launcher_update(config, restart_player=False)
        agent_result = apply_agent_update(config, reason='repair-installation', schedule_restart=True)
        restart_player_process(config)
        return 'Signage-Runtime repariert: Launcher neu geschrieben, Agent aktualisiert, Player neu gestartet.', {
            'launcher': launcher_result,
            'agent': agent_result,
            'playerRestarted': True,
        }

    if command_type == 'reboot_device':
        schedule_system_action('sudo /usr/sbin/reboot || sudo /sbin/reboot')
        return 'Geraet wird neu gestartet.', {'scheduled': True}

    if command_type == 'shutdown_device':
        schedule_system_action('sudo /usr/sbin/poweroff || sudo /sbin/poweroff')
        return 'Geraet wird heruntergefahren.', {'scheduled': True}

    raise RuntimeError(f'Unsupported command: {command_type}')


def main():
    next_health_at = 0

    while True:
        try:
            config = load_config()
            state = load_state(config)
            state = run_watchdog_cycle(config, state)
            save_state(config, state)

            now = time.time()
            if now >= next_health_at:
                post_health(config, state)
                config = load_config()
                apply_auto_updates(config)
                next_health_at = now + HEALTH_INTERVAL_SECONDS

            config = load_config()
            commands = fetch_commands(config)
            for command in commands:
                command_id = command.get('id')
                if not command_id:
                    continue

                try:
                    update_command(config, command_id, 'acknowledged', 'Befehl wird ausgefuehrt.')
                    message, result = execute_command(command)
                    update_command(load_config(), command_id, 'completed', message, result)
                    next_health_at = 0
                except Exception as error:
                    update_command(
                        load_config(),
                        command_id,
                        'failed',
                        str(error),
                        {'commandType': command.get('command_type')},
                    )
                    log_event(
                        'error',
                        'device-command',
                        f"Befehl {command.get('command_type')} fehlgeschlagen.",
                        {'error': str(error)},
                    )

        except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError):
            pass
        except Exception:
            pass

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(0))
    signal.signal(signal.SIGINT, lambda signum, frame: sys.exit(0))
    main()
`;
}

module.exports = {
    DEVICE_AGENT_VERSION,
    buildDeviceAgentScript,
};
