"""Create the first administrator and an empty workspace; never overwrite a database."""
import getpass
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend import store


def create_workspace(email, password, organization, port_name):
    email = email.strip().lower()
    if '@' not in email or not email.split('@')[0] or not email.split('@')[-1]:
        raise ValueError('Enter a valid administrator email address')
    if len(password) < 12:
        raise ValueError('Use a password of at least 12 characters')
    if not organization.strip() or not port_name.strip():
        raise ValueError('Organization and port names are required')
    store.initialize()
    with store.connect() as c:
        if c.execute('SELECT 1 FROM users LIMIT 1').fetchone():
            raise ValueError('This database already has users; configure it through the application')
        org, admin, port = store.uid(), store.uid(), store.uid()
        c.execute('INSERT INTO organizations VALUES(?,?)', (org, organization.strip()))
        c.execute('INSERT INTO users(id,org_id,email,name,password,superadmin) VALUES(?,?,?,?,?,1)',
                  (admin, org, email, 'Administrator', store.password_hash(password)))
        data = dict(name=port_name.strip(), code='PORT', timezone='UTC', center=[0, 0], zoom=2,
                    brand='Portside', boundary=None, mode='live', departments=['Operations'], products=[],
                    cargo_catalog=[], rules={'buffer_hours':1},
                    workflow={'departments':['Operations'], 'segregation':True, 'mode':'parallel'},
                    integration={'enabled':False, 'provider':'marinetraffic-client', 'freshness_minutes':30})
        c.execute('INSERT INTO ports(id,org_id,data) VALUES(?,?,?)', (port, org, json.dumps(data)))
        c.execute('INSERT INTO memberships VALUES(?,?,?,?,?)',
                  (admin, port, 'Administration', 'Administrator', json.dumps(store.PERMISSIONS)))
    return port


if __name__ == '__main__':
    try:
        email = input('Administrator email: ')
        password = getpass.getpass('Password (at least 12 characters): ')
        if password != getpass.getpass('Confirm password: '):
            raise ValueError('Passwords do not match')
        create_workspace(email, password, input('Organization name: '), input('Port name: '))
        print('Empty workspace created. Start Portside and sign in with your chosen credentials.')
    except (ValueError, EOFError, KeyboardInterrupt) as exc:
        sys.exit(str(exc) or 'Setup cancelled')
