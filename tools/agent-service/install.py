"""Publish a staged first installation. Run with sudo on the portal origin."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

PORTAL = Path('/var/www/portal')
NGINX = Path('/etc/nginx')
NAME = 'bobbycn-agent-directory'
SOURCE = Path(__file__).resolve().parents[2]
RECEIPT = SOURCE.parent / 'rollback'
CONFIGS = ['conf.d/portal.conf', 'snippets/blog.conf']
PUBLIC = ['index.html', 'robots.txt', 'auth.md', 'assets/agent-directory.js']


def run(*args):
    return subprocess.run(args, check=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def replace(source, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=dest.parent)
    os.close(fd)
    try:
        shutil.copy2(source, name)
        if dest.exists():
            old = dest.stat()
            os.chown(name, old.st_uid, old.st_gid)
        os.replace(name, dest)
    finally:
        Path(name).unlink(missing_ok=True)


def restore():
    plan = json.loads((RECEIPT / 'changes.json').read_text())
    for row in reversed(plan):
        dest = Path(row['path'])
        if not dest.exists() or digest(dest) != row['after']:
            continue
        if row['backup']:
            replace(RECEIPT / row['backup'], dest)
        else:
            dest.unlink()
    run('nginx', '-t')
    run('systemctl', 'reload', 'nginx')
    if (RECEIPT / 'container-id').exists():
        run('docker', 'rm', '-f', (RECEIPT / 'container-id').read_text().strip())


def start():
    args = ['docker', 'run', '-d', '--pull=never', '--restart=unless-stopped', '--name', NAME,
            '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--user', '65534:65534',
            '--memory=192m', '--cpus=0.7', '--pids-limit=48', '--log-opt=max-size=2m',
            '--log-opt=max-file=2', '-p', '127.0.0.1:18746:18746', '-e', 'HOST=0.0.0.0',
            '-e', 'PORTAL_ROOT=/public', '-e', 'BLOG_POSTS_ROOT=/published-posts',
            '-v', f'{SOURCE}:/app:ro', '-v', '/opt/stockgame/blog-dist/posts:/published-posts:ro']
    for page in ['index.html', 'games/index.html', 'resources/index.html', 'sponsor/index.html']:
        if not (PORTAL / page).is_file():
            raise RuntimeError('Missing public page: ' + page)
        args.extend(['--mount', f'type=bind,src={PORTAL / page},dst=/public/{page},readonly'])
    args.extend(['--entrypoint=node', 'node:22-alpine', '/app/tools/agent-service/server.cjs'])
    cid = subprocess.check_output(args, text=True).strip()
    (RECEIPT / 'container-id').write_text(cid)
    req = urllib.request.Request('http://127.0.0.1:18746/_agent/content',
                                 headers={'X-Agent-Page': '/', 'Accept': 'text/markdown'})
    for attempt in range(12):
        try:
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.headers.get_content_type() != 'text/markdown' or b'https://bobbycn.cc/' not in resp.read():
                    raise RuntimeError('Unexpected root Markdown')
            return
        except OSError:
            if attempt == 11:
                raise
            time.sleep(.5)


def install():
    if not (PORTAL / 'index.html').is_file() or not (SOURCE / 'robots.txt').is_file():
        raise RuntimeError('Invalid origin or payload')
    RECEIPT.mkdir(mode=0o700)
    stage = RECEIPT / 'nginx-staged'
    for item in CONFIGS:
        (stage / item).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(NGINX / item, stage / item)
    # Older published cache templates may include these files.
    for item in ['snippets/portal-cache.conf', 'conf.d/00-site-maps.conf']:
        if (NGINX / item).is_file():
            shutil.copy2(NGINX / item, stage / item)
    run('python3', str(SOURCE / 'tools/agent-service/nginx/configure.py'), '--root', str(stage))
    public = PUBLIC + [str(f.relative_to(SOURCE)) for f in sorted((SOURCE / '.well-known').rglob('*')) if f.is_file()]
    pairs = [(SOURCE / name, PORTAL / name) for name in public]
    for file in sorted(stage.rglob('*.conf')):
        pairs.append((file, NGINX / file.relative_to(stage)))
    plan, changed = [], []
    base = (PORTAL / 'index.html').read_bytes().replace(b'\r\n', b'\n')
    new = (SOURCE / 'index.html').read_bytes().replace(b'\r\n', b'\n')
    if base != new and [line for line in new.splitlines() if b'src="/assets/agent-directory.js' not in line] != base.splitlines():
        raise RuntimeError('The live homepage has diverged')
    for src, dest in pairs:
        if dest.is_symlink():
            raise RuntimeError('Refusing to replace a symlink: ' + str(dest))
        if dest.is_file() and digest(src) == digest(dest):
            continue
        if dest.is_file() and dest not in [PORTAL / 'index.html', *[NGINX / item for item in CONFIGS]]:
            raise RuntimeError('Destination already in use: ' + str(dest))
        backup = None
        if dest.exists():
            backup = 'old-' + str(len(plan))
            shutil.copy2(dest, RECEIPT / backup)
        plan.append({'path': str(dest), 'backup': backup, 'after': digest(src)})
        changed.append((src, dest))
    (RECEIPT / 'changes.json').write_text(json.dumps(plan, indent=2))
    try:
        for src, dest in changed:
            replace(src, dest)
        run('nginx', '-t')
        start()
        run('systemctl', 'reload', 'nginx')
    except BaseException:
        restore()
        raise
    print('Installed. Rollback: sudo python3 ' + str(Path(__file__).resolve()) + ' rollback')


if __name__ == '__main__':
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ('install', 'rollback'):
        raise SystemExit('Usage: sudo python3 install.py install|rollback')
    (install if sys.argv[1] == 'install' else restore)()
