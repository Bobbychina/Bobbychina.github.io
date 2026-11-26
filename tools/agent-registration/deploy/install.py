"""Install the directory-only registration service after the public catalogue."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import urlopen

RELEASE = Path(__file__).resolve().parents[1]
BASE = Path('/opt/bobbycn-agent-registration')
CURRENT = BASE / 'current'
PORTAL = Path('/var/www/portal')
VHOST = Path('/etc/nginx/conf.d/portal.conf')
SNIPPETS = Path('/etc/nginx/snippets')
HERE = RELEASE / 'deploy'
SAVE = RELEASE / 'rollback'
UNIT = 'bobbycn-agent-registration.service'


def run(*args):
    subprocess.run(args, check=True)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(path, data):
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(data)
        if path.exists():
            info = path.stat()
            os.chown(tmp, info.st_uid, info.st_gid)
            os.chmod(tmp, info.st_mode & 0o777)
        else:
            os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    finally:
        Path(tmp).unlink(missing_ok=True)


def wait_ready():
    for attempt in range(10):
        try:
            urlopen('http://127.0.0.1:18747/agent/directory', timeout=2)
        except HTTPError as err:
            if err.code == 401:
                return
            raise
        except OSError:
            time.sleep(.5)
    raise RuntimeError('The directory did not require an agent credential')


def rollback():
    if CURRENT.exists() and CURRENT.resolve() != RELEASE:
        raise RuntimeError('A different release is active')
    if (Path('/etc/systemd/system') / UNIT).is_file():
        subprocess.run(['systemctl', 'disable', '--now', UNIT], check=False)
    for row in reversed(json.loads((SAVE / 'plan.json').read_text())):
        path = Path(row['path'])
        if path.exists() and sha(path.read_bytes()) == row['after']:
            if row['backup'] is None:
                path.unlink()
            else:
                write(path, (SAVE / row['backup']).read_bytes())
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    if CURRENT.is_symlink():
        CURRENT.unlink()
    run('systemctl', 'daemon-reload')


def install():
    if CURRENT.exists() or CURRENT.is_symlink() or (Path('/etc/systemd/system') / UNIT).exists():
        raise RuntimeError('Service is already installed')
    desired = {
        SNIPPETS / 'agent-registration-locations.conf': (HERE / 'registration-locations.conf').read_bytes(),
        SNIPPETS / 'agent-registration-proxy.conf': (HERE / 'registration-proxy.conf').read_bytes(),
        Path('/etc/nginx/conf.d/01-agent-registration-limit.conf'):
            b'limit_req_zone $binary_remote_addr zone=agent_registration:1m rate=5r/s;\n',
        Path('/etc/systemd/system') / UNIT: (HERE / UNIT).read_bytes(),
    }
    if any(p.exists() for p in desired):
        raise RuntimeError('New service configuration collides with an existing file')
    current = VHOST.read_bytes()
    anchor = b'include /etc/nginx/snippets/agent-readiness-locations.conf;'
    if current.count(anchor) != 1:
        raise RuntimeError('Portal agent routes have diverged')
    desired[VHOST] = current.replace(anchor, anchor + b'\n    include /etc/nginx/snippets/agent-registration-locations.conf;')
    for name, before in json.loads((RELEASE / 'public-before.json').read_text()).items():
        dst = PORTAL / name
        data = (RELEASE / 'public' / name).read_bytes()
        if dst.is_file() and data == dst.read_bytes():
            continue
        if (sha(dst.read_bytes()) if dst.exists() else None) != before:
            raise RuntimeError('Public resource changed since staging: ' + name)
        desired[dst] = data
    SAVE.mkdir(mode=0o700)
    plan = []
    for dest, data in desired.items():
        if dest.is_symlink():
            raise RuntimeError('Unexpected symlink: ' + str(dest))
        backup = None
        if dest.is_file():
            backup = 'old-' + str(len(plan))
            shutil.copy2(dest, SAVE / backup)
        plan.append({'path': str(dest), 'after': sha(data), 'backup': backup})
    (SAVE / 'plan.json').write_text(json.dumps(plan))
    try:
        CURRENT.symlink_to(RELEASE, target_is_directory=True)
        for dest, data in desired.items():
            write(dest, data)
        run('nginx', '-t')
        run('systemctl', 'daemon-reload')
        run('systemctl', 'enable', '--now', UNIT)
        wait_ready()
        run('systemctl', 'reload', 'nginx')
    except BaseException:
        rollback()
        raise
    print('Installed ' + UNIT)


if __name__ == '__main__':
    if os.geteuid() or len(sys.argv) != 2 or sys.argv[1] not in ('install', 'rollback'):
        raise SystemExit('Usage: sudo python3 deploy/install.py install|rollback')
    (install if sys.argv[1] == 'install' else rollback)()
