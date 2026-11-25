#!/usr/bin/python3
"""One-time, narrow OVH administrative handoff for Groq configuration.

Run this installer once as root. It does not receive or read the Groq key.
Only the installed root-owned helper can receive a key on stdin, update
GROQ_API_KEY in app.json, and revoke its own temporary sudo permission.
It never grants an interactive shell, Docker access, or arbitrary file writes.
"""
import os
import pwd
import stat
import subprocess
import tempfile
from pathlib import Path

HELPER = Path('/usr/local/sbin/liftorbit-set-groq-key')
RULE = Path('/etc/sudoers.d/liftorbit-groq-key')
SOURCE = r'''#!/usr/bin/python3 -I
import fcntl
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

CONFIG = Path('/opt/liftorbit/secrets/app.json')
RULE = Path('/etc/sudoers.d/liftorbit-groq-key')

def run():
    if os.geteuid() != 0 or len(sys.argv) != 1:
        raise ValueError()
    value = sys.stdin.buffer.read(512)
    if len(value) >= 512:
        raise ValueError()
    key = value.decode('ascii').strip()
    if not re.fullmatch(r'gsk_[A-Za-z0-9_-]{20,200}', key):
        raise ValueError()
    parent = CONFIG.parent
    if parent.resolve(strict=True) != parent or not parent.is_dir():
        raise ValueError()
    st = parent.stat()
    if st.st_uid != 0 or st.st_mode & 0o022:
        raise ValueError()
    with os.fdopen(os.open(CONFIG, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
        fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        old = os.fstat(stream.fileno())
        if not stat.S_ISREG(old.st_mode) or old.st_uid != 0 or old.st_mode & 0o077 or not 0 < old.st_size <= 128*1024*1024:
            raise ValueError()
        data = json.load(stream)
        if not isinstance(data, dict) or not all(isinstance(k,str) and isinstance(v,str) for k,v in data.items()):
            raise ValueError()
        data['GROQ_API_KEY'] = key
        fd, tmp = tempfile.mkstemp(prefix='.app-groq-', dir=parent)
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as out:
                os.fchmod(out.fileno(),0o600)
                os.fchown(out.fileno(),old.st_uid,old.st_gid)
                json.dump(data,out,ensure_ascii=False,separators=(',',':'))
                out.flush()
                os.fsync(out.fileno())
            current = CONFIG.stat(follow_symlinks=False)
            if (current.st_ino,current.st_mtime_ns,current.st_size) != (old.st_ino,old.st_mtime_ns,old.st_size):
                raise ValueError()
            os.replace(tmp,CONFIG)
            d = os.open(parent,os.O_DIRECTORY|os.O_RDONLY)
            try: os.fsync(d)
            finally: os.close(d)
        finally:
            if os.path.exists(tmp): os.unlink(tmp)
    # Revoke only the temporary, narrowly scoped rule created by the installer.
    RULE.unlink()
    print('LIFTORBIT_GROQ_KEY_CONFIGURED_PERMISSION_REVOKED',flush=True)

if __name__ == '__main__':
    try: run()
    except Exception:
        print('LIFTORBIT_GROQ_KEY_CONFIGURATION_FAILED',file=sys.stderr)
        sys.exit(6)
'''
SUDO_RULE = 'liftorbit-ci ALL=(root) NOPASSWD: /usr/local/sbin/liftorbit-set-groq-key ""\n'

def put(path, body, mode):
    if path.parent.resolve(strict=True) != path.parent or path.exists() or path.is_symlink():
        raise ValueError('unexpected_existing_path')
    parent=path.parent.stat()
    if parent.st_uid != 0 or parent.st_mode & 0o022:
        raise ValueError('unsafe_parent')
    fd,tmp=tempfile.mkstemp(prefix='.groq-install-',dir=path.parent)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as f:
            os.fchown(f.fileno(),0,0);os.fchmod(f.fileno(),mode)
            f.write(body);f.flush();os.fsync(f.fileno())
        # Hard-link publication fails if another file appeared meanwhile.
        os.link(tmp,path,follow_symlinks=False)
    finally:
        os.unlink(tmp)

def install():
    if os.geteuid()!=0:raise ValueError('root_required')
    pwd.getpwnam('liftorbit-ci')
    config=Path('/opt/liftorbit/secrets/app.json')
    s=config.stat(follow_symlinks=False)
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o077:
        raise ValueError('unexpected_config_permissions')
    if HELPER.exists() or HELPER.is_symlink() or RULE.exists() or RULE.is_symlink():
        raise ValueError('existing_helper_or_rule')
    put(HELPER,SOURCE,0o700)
    try:
        put(RULE,SUDO_RULE,0o440)
        try:
            subprocess.run(['/usr/sbin/visudo','-cf',str(RULE)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            subprocess.run(['/usr/sbin/visudo','-c'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        except Exception:
            RULE.unlink()
            raise
    except Exception:
        HELPER.unlink()
        raise
    print('LIFTORBIT_GROQ_ONE_TIME_PERMISSION_READY')

if __name__=='__main__':
    try:install()
    except Exception:
        print('LIFTORBIT_GROQ_INSTALL_REJECTED')
        raise SystemExit(6)
