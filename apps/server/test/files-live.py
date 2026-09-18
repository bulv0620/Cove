"""Opt-in live smoke test. FILES_TEST_CONFIG points to an external, mode-600 JSON file.
Required keys: baseUrl, adminUsername, adminPassword, smbUsername, smbPassword.
Creates a disposable application user and a uniquely named NAS fixture directory.
The NAS directory and application user are removed after successful verification.
Never run with credentials in argv or commit the configuration file.
"""
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import uuid


def run(config):
    base = config['baseUrl'].rstrip('/') + '/api'

    def request(path, body=None, method=None, token='', raw=False):
        headers = {'Authorization': 'Bearer ' + token}
        if body is not None:
            headers['Content-Type'] = 'application/octet-stream' if raw else 'application/json'
        data = body if raw else json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                return response.status, json.load(response) if response.status != 204 else None, response.headers
        except urllib.error.HTTPError as error:
            return error.code, json.load(error), error.headers

    status, login, _ = request('/auth/login', {'username': config['adminUsername'], 'password': config['adminPassword']})
    assert status == 201, 'Administrator login failed'
    admin = login['accessToken']
    status, roles, _ = request('/roles', token=admin)
    assert status == 200, 'Cannot read roles'
    role = next(row['id'] for row in roles if row['code'] == 'administrator')
    username = 'filesverify_' + uuid.uuid4().hex[:12]
    status, created, _ = request('/users', {'username': username, 'roleIds': [role]}, token=admin)
    assert status == 201, 'Cannot create test identity'
    user_id = created['user']['id']
    root = 'Cove-live-' + uuid.uuid4().hex[:12]
    try:
        temporary = created['temporaryPassword']
        status, login, _ = request('/auth/login', {'username': username, 'password': temporary})
        token = login['accessToken']
        password = uuid.uuid4().hex + '!Aa'
        status, _, _ = request('/auth/change-password', {'currentPassword': temporary, 'newPassword': password}, token=token)
        assert status == 204
        _, login, _ = request('/auth/login', {'username': username, 'password': password})
        token = login['accessToken']
        status, _, _ = request('/files/entries?path=', token=token)
        assert status == 409, 'Unbound identity gained Files access'
        status, summary, _ = request('/users/' + user_id + '/smb-binding', {
            'username': config['smbUsername'], 'password': config['smbPassword'], 'expectedVersion': None,
        }, method='PUT', token=admin)
        assert status == 200, 'SMB binding failed'
        assert not any(key in summary for key in ('password', 'ciphertext', 'nonce', 'authTag'))
        status, _, _ = request('/files/directories', {'parentPath': '', 'name': root}, token=token)
        assert status == 201
        payload = b'Cove live streaming verification\n' * 4096
        name = 'Unicode-\u6d4b\u8bd5-%20.txt'
        for attempt in range(2):
            status, operation, _ = request('/files/uploads', {
                'parentPath': root, 'name': name, 'size': str(len(payload)), 'requestId': str(uuid.uuid4()),
            }, token=token)
            assert status == 201
            status, result, _ = request('/files/uploads/' + operation['id'] + '/content', payload, method='PUT', token=token, raw=True)
            assert status == (200 if attempt == 0 else 409), 'No-overwrite contract failed'
            if attempt == 0:
                assert result['state'] == 'SUCCEEDED'
        status, rows, _ = request('/files/entries?' + urllib.parse.urlencode({'path': root}), token=token)
        assert status == 200 and [row['name'] for row in rows['entries']] == [name]
        status, ticket, headers = request('/files/download-tickets', {'path': root + '/' + name}, token=token)
        assert status == 201
        cookie = headers['Set-Cookie'].split(';')[0]
        download = urllib.request.Request(config['baseUrl'].rstrip('/') + ticket['url'], headers={'Cookie': cookie})
        with urllib.request.urlopen(download, timeout=60) as response:
            assert hashlib.sha256(response.read()).digest() == hashlib.sha256(payload).digest()
        renamed = 'Renamed-\u6d4b\u8bd5.txt'
        status, entry, _ = request('/files/entries', {
            'path': root + '/' + name, 'name': renamed,
        }, method='PATCH', token=token)
        assert status == 200 and entry['name'] == renamed, 'Rename failed'
        status, _, _ = request('/files/directories', {
            'parentPath': root, 'name': 'non-empty',
        }, token=token)
        assert status == 201
        status, _, _ = request('/files/directories', {
            'parentPath': root + '/non-empty', 'name': 'child',
        }, token=token)
        assert status == 201
        status, removed, _ = request('/files/entries', {
            'paths': [root + '/non-empty', root + '/' + renamed],
        }, method='DELETE', token=token)
        assert status == 200
        assert removed['deleted'] == [root + '/' + renamed]
        assert removed['failed'] == [{'path': root + '/non-empty', 'code': 'DIRECTORY_NOT_EMPTY'}]
        for target in (root + '/non-empty/child', root + '/non-empty', root):
            status, removed, _ = request('/files/entries', {'paths': [target]}, method='DELETE', token=token)
            assert status == 200 and removed == {'deleted': [target], 'failed': []}
        status, _, _ = request('/files/stat?' + urllib.parse.urlencode({'path': '../other'}), token=token)
        assert status == 400
        print('PASS: binding, personal folder, Unicode upload, conflict preservation, listing, download checksum, rename, partial delete, cleanup, traversal rejection.')
    finally:
        status, _, _ = request('/users/' + user_id, method='DELETE', token=admin)
        assert status == 204, 'Remove the disposable test user manually'


if __name__ == '__main__':
    with open(os.environ['FILES_TEST_CONFIG'], encoding='utf8') as config_file:
        run(json.load(config_file))
