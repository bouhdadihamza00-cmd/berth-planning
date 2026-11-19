"""Start a hosted client trial; bootstrap only a new, explicitly selected database."""
import os
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import store
from scripts.create_workspace import create_workspace


def initialize_trial():
    if not os.environ.get('PORTOPS_DB'):
        raise ValueError('Set PORTOPS_DB to the persistent trial database path')
    store.initialize()
    with store.connect() as db:
        if db.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            return False
    email = os.environ.get('PORTSIDE_SETUP_EMAIL', '')
    password = os.environ.get('PORTSIDE_SETUP_PASSWORD', '')
    if not email or not password:
        raise ValueError('Set PORTSIDE_SETUP_EMAIL and PORTSIDE_SETUP_PASSWORD for first startup')
    create_workspace(email, password,
                     os.environ.get('PORTSIDE_SETUP_ORGANIZATION', 'Client trial'),
                     os.environ.get('PORTSIDE_SETUP_PORT', 'New port'))
    return True


if __name__ == '__main__':
    try:
        port = int(os.environ.get('PORT', '8000'))
        if not 1 <= port <= 65535:
            raise ValueError('PORT must be between 1 and 65535')
        created = initialize_trial()
        os.environ.pop('PORTSIDE_SETUP_PASSWORD', None)
        print('Empty trial workspace created.' if created else 'Using existing trial workspace.', flush=True)
        os.execv(sys.executable, [sys.executable, '-m', 'uvicorn', 'backend.main:app',
                                 '--host', '0.0.0.0', '--port', str(port),
                                 '--proxy-headers', '--forwarded-allow-ips', '*'])
    except (ValueError, OSError) as exc:
        sys.exit(str(exc))
