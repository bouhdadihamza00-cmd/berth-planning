"""Back up the live SQLite database, including original uploaded documents."""
import argparse
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import store


def backup_workspace(directory=None):
    source = Path(store.DB_PATH).resolve()
    directory = Path(directory or source.parent / 'backups').resolve()
    if directory.is_relative_to(store.ROOT / 'frontend'):
        raise ValueError('Backups must not be stored in public frontend assets')
    if not source.is_file():
        raise ValueError('No workspace database exists to back up')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    target = directory / f'portside-{stamp}.sqlite'
    target.touch(mode=0o600, exist_ok=False)
    try:
        with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as live:
            with sqlite3.connect(target) as snapshot:
                live.backup(snapshot)
                if snapshot.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise ValueError('Backup integrity check failed')
    except Exception:
        target.unlink(missing_ok=True)
        raise
    cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).timestamp()
    for old in directory.glob('portside-*.sqlite'):
        if old.is_file() and old.stat().st_mtime < cutoff:
            old.unlink()
    return target


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory')
    args = parser.parse_args()
    try:
        print(backup_workspace(args.directory))
    except (ValueError, OSError, sqlite3.Error) as exc:
        sys.exit(str(exc))
